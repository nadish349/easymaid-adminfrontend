const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');
const { 
  createMirroredBooking, 
  deleteMirroredBooking,
  repairMirroredBooking,
  validateBookingSync
} = require('../utils/bookingSync');
const { 
  syncAssignedStatus,
  syncBookingUpdate,
  validateStatusSync,
  forceSyncBooking,
  getSyncStatus
} = require('../utils/statusSync');
const { 
  manualSyncByCustomerId,
  findAndSyncUserBooking,
  syncAllCustomerBookings,
  getManualSyncStatus
} = require('../utils/manualStatusSync');
const { 
  handleBookingCreationHours,
  handlePaymentStatusChangeHours,
  handleBookingDeletionHours
} = require('../utils/userHoursController');
const { authenticateToken } = require('../middleware/auth');
const { 
  sendBookingConfirmation,
  sendBookingCancellation,
  sendPaymentConfirmation
} = require('../controllers/emailController');

// Apply authentication to all routes except /stream
router.use((req, res, next) => {
  if (req.path === '/stream') {
    return next(); // Skip authentication for stream endpoint
  }
  return authenticateToken(req, res, next);
});

// GET /bookings - fetch all bookings
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('bookings').get();
    const bookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// GET /bookings/stream - Server-Sent Events for real-time updates
router.get('/stream', (req, res) => {
  // Check authentication via query parameter (since SSE can't use headers easily)
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  // Verify token
  const { verifyToken } = require('../utils/jwt');
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection message
  res.write('data: {"type": "connected", "message": "SSE connection established"}\n\n');

  // Set up Firebase real-time listener
  const unsubscribe = db.collection('bookings')
    .onSnapshot(
      (snapshot) => {
        try {
          const bookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          const data = JSON.stringify({ type: 'bookings', data: bookings });
          res.write(`data: ${data}\n\n`);
        } catch (error) {
          console.error('Error in SSE snapshot:', error);
          res.write(`data: {"type": "error", "message": "Failed to process bookings"}\n\n`);
        }
      },
      (error) => {
        console.error('SSE Firebase listener error:', error);
        res.write(`data: {"type": "error", "message": "Firebase connection failed"}\n\n`);
      }
    );

  // Handle client disconnect
  req.on('close', () => {
    console.log('SSE client disconnected');
    unsubscribe();
  });

  // Handle server shutdown
  process.on('SIGINT', () => {
    unsubscribe();
    res.end();
  });
});

// POST /bookings - create a new booking
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    
    // Validate required fields
    if (!data.userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    if (!data.totalAmount || isNaN(parseFloat(data.totalAmount))) {
      return res.status(400).json({ error: 'Valid totalAmount is required' });
    }
    
    // Ensure createdAt is set
    if (!data.createdAt) {
      data.createdAt = new Date().toISOString();
    }
    
    // Initialize dueBalance to totalAmount if not set
    if (data.dueBalance === undefined) {
      data.dueBalance = parseFloat(data.totalAmount);
    }
    
    // Track booking source - if not specified, assume 'user' (from user frontend)
    // Admin bookings should explicitly set source: 'admin'
    if (!data.source) {
      data.source = 'user';
    }
    
    // Initialize multi-crew fields for jobs requiring multiple professionals
    const professionalsNeeded = parseInt(data.professionals, 10) || 1;
    if (professionalsNeeded > 1) {
      // Initialize arrays and counters for multi-crew jobs
      if (!data.assignedCrews) {
        data.assignedCrews = [];
      }
      if (data.professionalsAssigned === undefined) {
        data.professionalsAssigned = 0;
      }
      if (!data.confirmedCrews) {
        data.confirmedCrews = [];
      }
      if (data.professionalsConfirmed === undefined) {
        data.professionalsConfirmed = 0;
      }
    }
    
    // Create booking in main collection
    const docRef = await db.collection('bookings').add(data);
    const bookingId = docRef.id;
    
    console.log(`Created booking ${bookingId} in main collection`);
    
    // Create mirrored booking in user's subcollection
    const mirrorSuccess = await createMirroredBooking(bookingId, data.userId, data);
    if (!mirrorSuccess) {
      console.warn(`⚠️ Failed to create mirrored booking ${bookingId} for user ${data.userId}`);
    }
    
    // Update user's financial fields based on paymentStatus
    // Default behavior: Add to dueAmount (for unpaid bookings)
    if (data.userId && data.totalAmount) {
      try {
        const userRef = db.collection('users').doc(data.userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          const bookingAmount = parseFloat(data.totalAmount);
          const paymentStatus = data.paymentStatus || 'due'; // Default to 'due' if not specified
          
          const updateFields = {};
          
          if (paymentStatus === 'paid') {
            // If payment status is "paid", add to totalAmount
            const currentTotalAmount = userData.totalAmount || 0;
            const newTotalAmount = currentTotalAmount + bookingAmount;
            updateFields.totalAmount = newTotalAmount;
            
            console.log(`Updated user ${data.userId} totalAmount from ${currentTotalAmount} to ${newTotalAmount} (paymentStatus: paid)`);
          } else {
            // If payment status is "due" or not specified, add to dueAmount only
            const currentDueAmount = userData.dueAmount || 0;
            const newDueAmount = currentDueAmount + bookingAmount;
            updateFields.dueAmount = newDueAmount;
            
            console.log(`Updated user ${data.userId} dueAmount from ${currentDueAmount} to ${newDueAmount} (paymentStatus: ${paymentStatus})`);
          }
          
          await userRef.update(updateFields);
        } else {
          console.log(`User ${data.userId} not found, skipping financial update`);
        }
      } catch (userUpdateErr) {
        console.error('Error updating user financial fields:', userUpdateErr);
        // Don't fail the booking creation if user update fails
      }
    }
    
    // Handle user hours increment based on payment status and source
    if (data.userId && data.hours) {
      const hoursValue = parseInt(data.hours, 10);
      const paymentStatus = data.paymentStatus || 'due';
      const source = data.source || 'user';
      
      await handleBookingCreationHours(data.userId, hoursValue, paymentStatus, source, bookingId);
    }
    
    // Send booking confirmation email
    try {
      // Get user email if not provided in booking data
      let userEmail = data.email;
      if (!userEmail && data.userId) {
        const userDoc = await db.collection('users').doc(data.userId).get();
        if (userDoc.exists) {
          userEmail = userDoc.data().email;
        }
      }
      
      const emailData = {
        ...data,
        id: bookingId,
        email: userEmail
      };
      
      const emailResult = await sendBookingConfirmation(emailData);
      if (emailResult.success) {
        console.log(`📧 Booking confirmation email sent for booking ${bookingId}`);
      } else {
        console.warn(`⚠️ Failed to send booking confirmation email: ${emailResult.error}`);
      }
    } catch (emailErr) {
      // Don't fail the booking if email fails
      console.error('Error sending booking confirmation email:', emailErr);
    }
    
    res.status(201).json({ id: bookingId, ...data });
  } catch (err) {
    console.error('Error creating booking:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PATCH /bookings/:id - update a booking (used by frontend)
// DELETED: Duplicate PATCH /:id route moved to line 1702 with proper crew hours increment logic

// PUT /bookings/:id - update a booking with crew synchronization
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📝 BOOKING UPDATE - ID: ${id}`);
    console.log(`${'='.repeat(80)}`);
    
    // Get current booking data
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const userId = bookingData.userId;
    
    // Extract original values
    const originalHours = parseInt(bookingData.hours, 10) || 0;
    const originalProfessionals = parseInt(bookingData.professionals, 10) || 1;
    const originalTotalAmount = parseFloat(bookingData.totalAmount) || 0;
    const originalAssignedTo = bookingData.assignedTo || null;
    const originalAssignedCrews = bookingData.assignedCrews || [];
    const originalConfirmedCrews = bookingData.confirmedCrews || [];
    const assignedStatus = bookingData.assignedStatus || 'unassigned';
    
    // Build complete crew list (handle both single and multi-crew)
    let allAssignedCrews = [];
    if (originalAssignedCrews.length > 0) {
      allAssignedCrews = originalAssignedCrews;
    } else if (originalAssignedTo) {
      allAssignedCrews = [originalAssignedTo];
    }
    
    let allConfirmedCrews = [];
    if (originalConfirmedCrews.length > 0) {
      allConfirmedCrews = originalConfirmedCrews;
    } else if (originalAssignedTo && assignedStatus === 'confirm') {
      allConfirmedCrews = [originalAssignedTo];
    }
    
    // Extract new values
    const newHours = updateData.hours !== undefined ? parseInt(updateData.hours, 10) : originalHours;
    const newProfessionals = updateData.professionals !== undefined ? parseInt(updateData.professionals, 10) : originalProfessionals;
    const newTotalAmount = updateData.totalAmount !== undefined ? parseFloat(updateData.totalAmount) : originalTotalAmount;
    
    // Calculate changes
    const hoursDiff = newHours - originalHours;
    const professionalsDiff = newProfessionals - originalProfessionals;
    const amountDiff = newTotalAmount - originalTotalAmount;
    
    console.log(`📊 CHANGES DETECTED:`);
    console.log(`   Hours: ${originalHours} → ${newHours} (${hoursDiff >= 0 ? '+' : ''}${hoursDiff})`);
    console.log(`   Professionals: ${originalProfessionals} → ${newProfessionals} (${professionalsDiff >= 0 ? '+' : ''}${professionalsDiff})`);
    console.log(`   Amount: AED ${originalTotalAmount} → AED ${newTotalAmount} (${amountDiff >= 0 ? '+' : ''}${amountDiff})`);
    console.log(`   Status: ${assignedStatus}`);
    console.log(`   AssignedTo: ${originalAssignedTo || 'none'}`);
    console.log(`   Assigned Crews (array): [${originalAssignedCrews.join(', ') || 'none'}]`);
    console.log(`   All Assigned Crews: [${allAssignedCrews.join(', ') || 'none'}]`);
    console.log(`   Confirmed Crews: [${allConfirmedCrews.join(', ') || 'none'}]`);
    
    // Only update crews if job is assigned or confirmed
    if ((assignedStatus === 'assigned' || assignedStatus === 'confirm') && allAssignedCrews.length > 0) {
      console.log(`\n🔧 CREW UPDATE PROCESS:`);
      
      // Handle reducing professionals (remove last added crews)
      if (professionalsDiff < 0) {
        const crewsToRemove = allAssignedCrews.slice(newProfessionals);
        console.log(`\n🔻 REDUCING PROFESSIONALS:`);
        console.log(`   Removing ${crewsToRemove.length} crew(s): [${crewsToRemove.join(', ')}]`);
        
        for (const crewId of crewsToRemove) {
          const wasConfirmed = allConfirmedCrews.includes(crewId);
          
          if (wasConfirmed) {
            try {
              const crewRef = db.collection('crews').doc(crewId);
              const crewDoc = await crewRef.get();
              
              if (crewDoc.exists) {
                const crewData = crewDoc.data();
                const crewHours = parseFloat(crewData.hours) || 0;
                const crewAmount = parseFloat(crewData.totalAmount) || 0;
                const crewShare = originalTotalAmount / originalProfessionals;
                
                const updatedHours = Math.max(0, crewHours - originalHours);
                const updatedAmount = Math.max(0, crewAmount - crewShare);
                
                await crewRef.update({
                  hours: updatedHours,
                  totalAmount: updatedAmount,
                  updatedAt: new Date()
                });
                
                console.log(`   ✅ Crew ${crewId}:`);
                console.log(`      Hours: ${crewHours} → ${updatedHours} (-${originalHours})`);
                console.log(`      Amount: AED ${crewAmount.toFixed(2)} → AED ${updatedAmount.toFixed(2)} (-${crewShare.toFixed(2)})`);
              }
            } catch (err) {
              console.error(`   ❌ Error updating crew ${crewId}:`, err.message);
            }
          } else {
            console.log(`   ⏭️ Crew ${crewId} was not confirmed, skipping decrement`);
          }
        }
      }
      
      // Handle increasing professionals
      if (professionalsDiff > 0) {
        console.log(`\n🔺 INCREASING PROFESSIONALS:`);
        console.log(`   Need ${professionalsDiff} more crew(s) - assign manually after update`);
      }
      
      // Update existing confirmed crews with hour/amount changes
      if ((hoursDiff !== 0 || amountDiff !== 0) && allConfirmedCrews.length > 0) {
        const crewsToUpdate = professionalsDiff < 0 
          ? allConfirmedCrews.filter(crewId => allAssignedCrews.slice(0, newProfessionals).includes(crewId))
          : allConfirmedCrews;
        
        if (crewsToUpdate.length > 0) {
          console.log(`\n🔄 UPDATING ${crewsToUpdate.length} CONFIRMED CREW(S):`);
          
          const oldShare = originalTotalAmount / originalProfessionals;
          const newShare = newTotalAmount / newProfessionals;
          const shareDiff = newShare - oldShare;
          
          console.log(`   Old share per crew: AED ${oldShare.toFixed(2)}`);
          console.log(`   New share per crew: AED ${newShare.toFixed(2)}`);
          console.log(`   Share difference: AED ${shareDiff.toFixed(2)}`);
          
          for (const crewId of crewsToUpdate) {
            try {
              const crewRef = db.collection('crews').doc(crewId);
              const crewDoc = await crewRef.get();
              
              if (crewDoc.exists) {
                const crewData = crewDoc.data();
                const crewHours = parseFloat(crewData.hours) || 0;
                const crewAmount = parseFloat(crewData.totalAmount) || 0;
                
                const updatedHours = Math.max(0, crewHours + hoursDiff);
                const updatedAmount = Math.max(0, crewAmount + shareDiff);
                
                await crewRef.update({
                  hours: updatedHours,
                  totalAmount: updatedAmount,
                  updatedAt: new Date()
                });
                
                console.log(`   ✅ Crew ${crewId}:`);
                console.log(`      Hours: ${crewHours} → ${updatedHours} (${hoursDiff >= 0 ? '+' : ''}${hoursDiff})`);
                console.log(`      Amount: AED ${crewAmount.toFixed(2)} → AED ${updatedAmount.toFixed(2)} (${shareDiff >= 0 ? '+' : ''}${shareDiff.toFixed(2)})`);
              }
            } catch (err) {
              console.error(`   ❌ Error updating crew ${crewId}:`, err.message);
            }
          }
        }
      }
    } else {
      console.log(`\n⏭️ SKIPPING CREW UPDATES:`);
      console.log(`   Reason: Job is ${assignedStatus} with ${allAssignedCrews.length} crew(s)`);
      console.log(`   AssignedTo: ${originalAssignedTo || 'none'}, AssignedCrews: [${originalAssignedCrews.join(', ') || 'none'}]`);
    }
    
    // Update crew fields based on professional count changes
    let updatedAssignedTo = originalAssignedTo;
    let updatedAssignedCrews = originalAssignedCrews;
    let updatedConfirmedCrews = originalConfirmedCrews;
    let updatedAssignedStatus = assignedStatus;
    let updatedProfessionalsAssigned = 0;
    let updatedProfessionalsConfirmed = 0;
    
    if (newProfessionals === 1) {
      // Converting to single-crew or staying single-crew
      if (allAssignedCrews.length > 0) {
        updatedAssignedTo = allAssignedCrews[0]; // Keep first crew
        updatedAssignedCrews = []; // Clear array for single-crew
        updatedConfirmedCrews = allConfirmedCrews.includes(allAssignedCrews[0]) ? [allAssignedCrews[0]] : [];
        updatedProfessionalsAssigned = 1;
        updatedProfessionalsConfirmed = allConfirmedCrews.includes(allAssignedCrews[0]) ? 1 : 0;
        // Keep original status
      }
    } else {
      // Multi-crew job
      
      if (originalProfessionals === 1 && newProfessionals > 1) {
        // Converting FROM single-crew TO multi-crew
        console.log(`\n🔄 CONVERTING SINGLE → MULTI-CREW:`);
        console.log(`   Moving job to unassigned (need to reassign all crews)`);
        
        // Move to unassigned - clear all crew assignments
        updatedAssignedTo = null;
        updatedAssignedCrews = [];
        updatedConfirmedCrews = [];
        updatedAssignedStatus = 'unassigned';
        updatedProfessionalsAssigned = 0;
        updatedProfessionalsConfirmed = 0;
        
        // Decrement the original single crew if it was confirmed
        if (allConfirmedCrews.length > 0 && allConfirmedCrews[0]) {
          try {
            const crewId = allConfirmedCrews[0];
            const crewRef = db.collection('crews').doc(crewId);
            const crewDoc = await crewRef.get();
            
            if (crewDoc.exists) {
              const crewData = crewDoc.data();
              const crewHours = parseFloat(crewData.hours) || 0;
              const crewAmount = parseFloat(crewData.totalAmount) || 0;
              
              const updatedHours = Math.max(0, crewHours - originalHours);
              const updatedAmount = Math.max(0, crewAmount - originalTotalAmount);
              
              await crewRef.update({
                hours: updatedHours,
                totalAmount: updatedAmount,
                updatedAt: new Date()
              });
              
              console.log(`   ✅ Decremented original crew ${crewId}:`);
              console.log(`      Hours: ${crewHours} → ${updatedHours} (-${originalHours})`);
              console.log(`      Amount: AED ${crewAmount.toFixed(2)} → AED ${updatedAmount.toFixed(2)} (-${originalTotalAmount.toFixed(2)})`);
            }
          } catch (err) {
            console.error(`   ❌ Error decrementing original crew:`, err.message);
          }
        }
      } else {
        // Staying multi-crew or other changes
        updatedAssignedTo = null; // Clear single field for multi-crew
        
        if (professionalsDiff < 0) {
          // Reducing: keep only first N crews
          updatedAssignedCrews = allAssignedCrews.slice(0, newProfessionals);
          updatedConfirmedCrews = allConfirmedCrews.filter(id => updatedAssignedCrews.includes(id));
          updatedProfessionalsAssigned = updatedAssignedCrews.length;
          updatedProfessionalsConfirmed = updatedConfirmedCrews.length;
          
          // Update status based on assignment
          if (updatedConfirmedCrews.length === newProfessionals) {
            updatedAssignedStatus = 'confirm';
          } else if (updatedAssignedCrews.length > 0) {
            updatedAssignedStatus = updatedAssignedCrews.length === newProfessionals ? 'assigned' : 'partially_assigned';
          } else {
            updatedAssignedStatus = 'unassigned';
          }
        } else if (professionalsDiff > 0) {
          // Increasing: keep all existing crews, but move to partially_assigned if not enough
          updatedAssignedCrews = allAssignedCrews;
          updatedConfirmedCrews = allConfirmedCrews;
          updatedProfessionalsAssigned = updatedAssignedCrews.length;
          updatedProfessionalsConfirmed = updatedConfirmedCrews.length;
          
          // Update status - now partially assigned since we need more crews
          if (updatedAssignedCrews.length === newProfessionals && updatedConfirmedCrews.length === newProfessionals) {
            updatedAssignedStatus = 'confirm';
          } else if (updatedAssignedCrews.length > 0) {
            updatedAssignedStatus = 'partially_assigned';
          } else {
            updatedAssignedStatus = 'unassigned';
          }
        } else {
          // No change in count
          updatedAssignedCrews = allAssignedCrews;
          updatedConfirmedCrews = allConfirmedCrews;
          updatedProfessionalsAssigned = updatedAssignedCrews.length;
          updatedProfessionalsConfirmed = updatedConfirmedCrews.length;
          // Keep original status
        }
      }
    }
    
    // Calculate financial updates
    const currentDueBalance = bookingData.dueBalance !== undefined ? parseFloat(bookingData.dueBalance) : originalTotalAmount;
    const newDueBalance = currentDueBalance + amountDiff;
    
    let paymentStatus = bookingData.paymentStatus || 'due';
    if (newDueBalance <= 0) {
      paymentStatus = 'paid';
    } else if (newDueBalance < newTotalAmount) {
      paymentStatus = 'partial';
    } else {
      paymentStatus = 'due';
    }
    
    // Prepare update payload
    const updatePayload = {
      ...updateData,
      assignedTo: updatedAssignedTo,
      assignedCrews: updatedAssignedCrews,
      confirmedCrews: updatedConfirmedCrews,
      assignedStatus: updatedAssignedStatus,
      professionalsAssigned: updatedProfessionalsAssigned,
      professionalsConfirmed: updatedProfessionalsConfirmed,
      dueBalance: newDueBalance,
      paymentStatus: paymentStatus,
      updatedAt: new Date().toISOString()
    };
    
    console.log(`\n📦 UPDATE PAYLOAD:`);
    console.log(`   assignedTo: ${updatePayload.assignedTo || 'null'}`);
    console.log(`   assignedCrews: [${updatePayload.assignedCrews.join(', ') || 'empty'}]`);
    console.log(`   confirmedCrews: [${updatePayload.confirmedCrews.join(', ') || 'empty'}]`);
    console.log(`   assignedStatus: ${updatePayload.assignedStatus}`);
    console.log(`   professionalsAssigned: ${updatePayload.professionalsAssigned}`);
    console.log(`   professionalsConfirmed: ${updatePayload.professionalsConfirmed}`);
    
    // Update main booking
    await bookingRef.update(updatePayload);
    console.log(`\n✅ BOOKING UPDATED IN MAIN COLLECTION`);
    
    // Sync to user subcollection
    if (userId) {
      try {
        const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(id);
        const userBookingDoc = await userBookingRef.get();
        
        if (userBookingDoc.exists) {
          await userBookingRef.update(updatePayload);
          console.log(`✅ SYNCED TO USER ${userId} SUBCOLLECTION`);
        } else {
          const fullData = { ...bookingData, ...updatePayload };
          await userBookingRef.set(fullData);
          console.log(`✅ CREATED IN USER ${userId} SUBCOLLECTION`);
        }
      } catch (err) {
        console.error(`❌ Error syncing to user subcollection:`, err.message);
      }
    }
    
    // Update user dueAmount if amount changed
    if (userId && amountDiff !== 0) {
      try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          const currentUserDue = parseFloat(userData.dueAmount) || 0;
          const newUserDue = Math.max(0, currentUserDue + amountDiff);
          
          await userRef.update({ dueAmount: newUserDue });
          console.log(`✅ UPDATED USER DUE AMOUNT: AED ${currentUserDue} → AED ${newUserDue}`);
        }
      } catch (err) {
        console.error(`❌ Error updating user dueAmount:`, err.message);
      }
    }
    
    console.log(`${'='.repeat(80)}`);
    console.log(`✅ UPDATE COMPLETE\n`);
    
    // Return updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json({ booking: updatedBooking });
  } catch (err) {
    console.error('❌ ERROR UPDATING BOOKING:', err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// PATCH /bookings/:id/payment-status - update payment status and handle financial changes
router.patch('/:id/payment-status', async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus, paidAmount } = req.body;
    
    // Validate payment status
    if (!paymentStatus || !['paid', 'partial', 'due'].includes(paymentStatus)) {
      return res.status(400).json({ error: 'Valid paymentStatus (paid/partial/due) is required' });
    }
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const userId = bookingData.userId;
    const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
    const currentPaymentStatus = bookingData.paymentStatus || 'due';
    const currentDueBalance = bookingData.dueBalance !== undefined ? parseFloat(bookingData.dueBalance) : bookingTotalAmount;
    
    // For partial payment, validate paidAmount
    if (paymentStatus === 'partial') {
      if (!paidAmount || isNaN(parseFloat(paidAmount)) || parseFloat(paidAmount) <= 0) {
        return res.status(400).json({ error: 'Valid paidAmount is required for partial payment' });
      }
      if (parseFloat(paidAmount) > currentDueBalance) {
        return res.status(400).json({ error: `Paid amount (${paidAmount}) cannot exceed due balance (${currentDueBalance})` });
      }
    }
    
    console.log(`💳 PAYMENT STATUS UPDATE: Booking ${id}, ${currentPaymentStatus} → ${paymentStatus}, Total: ${bookingTotalAmount}, Current Due Balance: ${currentDueBalance}`);
    
    let paymentAmount = 0;
    let newDueBalance = currentDueBalance;
    let finalPaymentStatus = paymentStatus;
    
    if (paymentStatus === 'paid') {
      // Full payment: pay entire due balance
      paymentAmount = currentDueBalance;
      newDueBalance = 0;
    } else if (paymentStatus === 'partial') {
      // Partial payment: pay specified amount
      paymentAmount = parseFloat(paidAmount);
      newDueBalance = currentDueBalance - paymentAmount;
      
      // If due balance becomes 0, change status to paid
      if (newDueBalance <= 0) {
        newDueBalance = 0;
        finalPaymentStatus = 'paid';
      }
    } else if (paymentStatus === 'due') {
      // Reverting to due: restore full amount
      const previouslyPaid = bookingTotalAmount - currentDueBalance;
      paymentAmount = -previouslyPaid; // Negative to reverse
      newDueBalance = bookingTotalAmount;
    }
    
    console.log(`💰 Payment calculation: Amount=${paymentAmount}, New Due Balance=${newDueBalance}`);
    
    // Update booking in main collection
    await bookingRef.update({
      paymentStatus: finalPaymentStatus,
      dueBalance: newDueBalance,
      updatedAt: new Date().toISOString(),
      paymentUpdatedAt: new Date().toISOString()
    });
    console.log(`✅ Updated payment status in main booking ${id}`);
    
    // Update mirrored booking in user's subcollection
    if (userId) {
      try {
        const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(id);
        const userBookingDoc = await userBookingRef.get();
        
        if (userBookingDoc.exists) {
          await userBookingRef.update({
            paymentStatus: finalPaymentStatus,
            dueBalance: newDueBalance,
            updatedAt: new Date().toISOString(),
            paymentUpdatedAt: new Date().toISOString()
          });
          console.log(`✅ Updated payment status in user ${userId} subcollection for booking ${id}`);
        } else {
          console.warn(`⚠️ Mirrored booking ${id} not found in user ${userId} subcollection`);
        }
      } catch (syncErr) {
        console.error('Error syncing payment status to user subcollection:', syncErr);
      }
    }
    
    // Update user's financial fields
    if (userId && paymentAmount !== 0) {
      try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          const currentTotalAmount = userData.totalAmount || 0;
          const currentUserDueAmount = userData.dueAmount || 0;
          
          const updateFields = {};
          
          if (paymentAmount > 0) {
            // Payment made: decrement dueAmount, increment totalAmount
            const newUserDueAmount = Math.max(0, currentUserDueAmount - paymentAmount);
            const newTotalAmount = currentTotalAmount + paymentAmount;
            
            updateFields.dueAmount = newUserDueAmount;
            updateFields.totalAmount = newTotalAmount;
            
            console.log(`💰 User ${userId} financial update:`);
            console.log(`   dueAmount: ${currentUserDueAmount} → ${newUserDueAmount} (-${paymentAmount})`);
            console.log(`   totalAmount: ${currentTotalAmount} → ${newTotalAmount} (+${paymentAmount})`);
          } else if (paymentAmount < 0) {
            // Payment reversed: increment dueAmount, decrement totalAmount
            const reverseAmount = Math.abs(paymentAmount);
            const newUserDueAmount = currentUserDueAmount + reverseAmount;
            const newTotalAmount = Math.max(0, currentTotalAmount - reverseAmount);
            
            updateFields.dueAmount = newUserDueAmount;
            updateFields.totalAmount = newTotalAmount;
            
            console.log(`💰 User ${userId} financial update (reversal):`);
            console.log(`   dueAmount: ${currentUserDueAmount} → ${newUserDueAmount} (+${reverseAmount})`);
            console.log(`   totalAmount: ${currentTotalAmount} → ${newTotalAmount} (-${reverseAmount})`);
          }
          
          if (Object.keys(updateFields).length > 0) {
            await userRef.update(updateFields);
            console.log(`✅ Updated user ${userId} financial fields`);
          }
        } else {
          console.log(`User ${userId} not found, skipping financial update`);
        }
      } catch (userUpdateErr) {
        console.error('Error updating user financial fields:', userUpdateErr);
      }
    }
    
    // Handle user hours update based on payment status change
    if (userId && bookingData.hours) {
      const hoursValue = parseInt(bookingData.hours, 10);
      
      await handlePaymentStatusChangeHours(
        userId, 
        hoursValue, 
        currentPaymentStatus, 
        finalPaymentStatus, 
        id
      );
    }
    
    // Send payment confirmation email if payment was made
    if (paymentAmount > 0 && userId) {
      try {
        // Get user email
        let userEmail = bookingData.email;
        if (!userEmail) {
          const userDoc = await db.collection('users').doc(userId).get();
          if (userDoc.exists) {
            userEmail = userDoc.data().email;
          }
        }
        
        if (userEmail) {
          const emailData = {
            ...bookingData,
            id,
            email: userEmail,
            dueBalance: newDueBalance
          };
          
          const emailResult = await sendPaymentConfirmation(emailData, paymentAmount);
          if (emailResult.success) {
            console.log(`📧 Payment confirmation email sent for booking ${id}`);
          } else {
            console.warn(`⚠️ Failed to send payment confirmation email: ${emailResult.error}`);
          }
        }
      } catch (emailErr) {
        console.error('Error sending payment confirmation email:', emailErr);
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json({ 
      success: true,
      message: paymentStatus === 'partial' 
        ? `Partial payment of AED ${paymentAmount.toFixed(2)} recorded. Remaining balance: AED ${newDueBalance.toFixed(2)}`
        : `Payment status updated to ${finalPaymentStatus}`,
      booking: updatedBooking,
      paidAmount: paymentAmount,
      dueBalance: newDueBalance
    });
  } catch (err) {
    console.error('Error updating payment status:', err);
    res.status(500).json({ error: 'Failed to update payment status' });
  }
});

// PATCH /bookings/:id/assign - assign a booking to a crew (legacy single-crew assignment)
router.patch('/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTo } = req.body;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const previousAssignedTo = bookingData.assignedTo;
    
    // Update the booking assignment
    const updateData = {
      updatedAt: new Date()
    };
    
    if (assignedTo === null || assignedTo === undefined) {
      // Unassign the booking
      updateData.assignedTo = null;
      updateData.assignedStatus = 'unassigned';
    } else {
      // Assign the booking
      updateData.assignedTo = assignedTo;
      updateData.assignedStatus = 'assigned';
    }
    
    await bookingRef.update(updateData);
    
    // Sync assignedStatus to user's subcollection
    const userId = bookingData.userId;
    if (userId && updateData.assignedStatus) {
      console.log(`🔄 ASSIGN UPDATE: Syncing status change for booking ${id}, user ${userId}, new status: ${updateData.assignedStatus}`);
      
      // Use manual sync method with customerId
      const syncSuccess = await manualSyncByCustomerId(id, userId, updateData.assignedStatus);
      
      if (syncSuccess) {
        console.log(`✅ ASSIGN UPDATE: Successfully synced status for booking ${id}`);
      } else {
        console.warn(`⚠️ ASSIGN UPDATE: Failed to sync assignedStatus for booking ${id} in user ${userId} subcollection`);
      }
    }
    
    // Handle crew hours tracking - only decrement when moving/unassigning
    if (hours > 0) {
      // If job was previously assigned to a crew, decrement their hours
      if (previousAssignedTo && previousAssignedTo !== assignedTo) {
        try {
          const previousCrewRef = db.collection('crews').doc(previousAssignedTo);
          const previousCrewDoc = await previousCrewRef.get();
          
          if (previousCrewDoc.exists) {
            const previousCrewData = previousCrewDoc.data();
            const currentHours = previousCrewData.hours || 0;
            const newHours = Math.max(0, currentHours - hours);
            
            await previousCrewRef.update({
              hours: newHours,
              updatedAt: new Date()
            });
            
            console.log(`Decremented ${hours} hours from crew ${previousAssignedTo} (job moved/unassigned)`);
          }
        } catch (crewUpdateErr) {
          console.error('Error decrementing hours from previous crew:', crewUpdateErr);
        }
      }
      
      // Note: We don't increment hours here - only when status changes to 'confirmed'
      // This endpoint is only for assignment/unassignment, not confirmation
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error assigning booking:', err);
    res.status(500).json({ error: 'Failed to assign booking' });
  }
});

// PATCH /bookings/:id/move-crew - move job between crews (handles both single and multi-crew)
router.patch('/:id/move-crew', async (req, res) => {
  try {
    const { id } = req.params;
    const { fromCrewId, toCrewId } = req.body;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
    const wasConfirmed = bookingData.assignedStatus === 'confirm';
    
    // Initialize multi-crew fields if they don't exist
    let assignedCrews = bookingData.assignedCrews || [];
    let confirmedCrews = bookingData.confirmedCrews || [];
    let professionalsAssigned = bookingData.professionalsAssigned || 0;
    let professionalsConfirmed = bookingData.professionalsConfirmed || 0;
    
    // If this is a single-crew job, migrate to multi-crew structure
    if (professionalsNeeded === 1) {
      if (bookingData.assignedTo && assignedCrews.length === 0) {
        assignedCrews = [bookingData.assignedTo];
        professionalsAssigned = 1;
        if (wasConfirmed) {
          confirmedCrews = [bookingData.assignedTo];
          professionalsConfirmed = 1;
        }
      }
    }
    
    // Validate that the job is assigned to the source crew
    if (!assignedCrews.includes(fromCrewId)) {
      return res.status(400).json({ error: 'Job is not assigned to the source crew' });
    }
    
    // Check if target crew is already assigned (for multi-crew jobs)
    if (assignedCrews.includes(toCrewId)) {
      return res.status(400).json({ error: 'Job is already assigned to the target crew' });
    }
    
    // Remove from source crew
    assignedCrews = assignedCrews.filter(id => id !== fromCrewId);
    professionalsAssigned = Math.max(0, professionalsAssigned - 1);
    
    // Check if source crew was confirmed
    const wasSourceCrewConfirmed = confirmedCrews.includes(fromCrewId);
    if (wasSourceCrewConfirmed) {
      confirmedCrews = confirmedCrews.filter(id => id !== fromCrewId);
      professionalsConfirmed = Math.max(0, professionalsConfirmed - 1);
    }
    
    // Add to target crew
    assignedCrews.push(toCrewId);
    professionalsAssigned += 1;
    
    // For single-crew jobs: Keep the confirmation status if job was confirmed
    // DO NOT auto-confirm target crew - but keep 'confirm' status if already confirmed
    let newStatus = 'assigned'; // Default for single-crew jobs after move
    if (professionalsNeeded === 1 && wasConfirmed) {
      // Keep 'confirm' status for single-crew jobs that were already confirmed
      newStatus = 'confirm';
      console.log(`✅ Single-crew confirmed job kept 'confirm' status when moved`);
    } else if (professionalsNeeded > 1) {
      // Multi-crew job status logic
      if (professionalsAssigned > 0 && professionalsAssigned < professionalsNeeded) {
        newStatus = 'partially_assigned';
      } else if (professionalsAssigned === professionalsNeeded) {
        newStatus = 'assigned';
      }
    }
    
    // Update the booking
    const updateData = {
      assignedCrews,
      professionalsAssigned,
      assignedStatus: newStatus,
      assignedTo: toCrewId, // Keep for backward compatibility
      confirmedCrews,
      professionalsConfirmed,
      updatedAt: new Date()
    };
    
    await bookingRef.update(updateData);
    
    // Sync assignedStatus to user's subcollection
    const userId = bookingData.userId;
    if (userId && updateData.assignedStatus) {
      console.log(`🔄 MOVE-CREW UPDATE: Syncing status change for booking ${id}, user ${userId}, new status: ${updateData.assignedStatus}`);
      
      const syncSuccess = await manualSyncByCustomerId(id, userId, updateData.assignedStatus);
      
      if (syncSuccess) {
        console.log(`✅ MOVE-CREW UPDATE: Successfully synced status for booking ${id}`);
      } else {
        console.warn(`⚠️ MOVE-CREW UPDATE: Failed to sync assignedStatus for booking ${id} in user ${userId} subcollection`);
      }
    }
    
    // Handle crew hours tracking
    if (hours > 0) {
      // For confirmed jobs (both single and multi-crew), handle hours/amount transfer
      if (wasConfirmed) {
        // Decrement from source crew
        try {
          const fromCrewRef = db.collection('crews').doc(fromCrewId);
          const fromCrewDoc = await fromCrewRef.get();
          
          if (fromCrewDoc.exists) {
            const fromCrewData = fromCrewDoc.data();
            const currentHours = fromCrewData.hours || 0;
            const newHours = Math.max(0, currentHours - hours);
            
            // Calculate crew's share of the booking amount to decrement
            const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
            const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
            const crewAmountShare = bookingTotalAmount / professionalsNeeded;
            
            const currentTotalAmount = parseFloat(fromCrewData.totalAmount) || 0;
            const newTotalAmount = Math.max(0, currentTotalAmount - crewAmountShare);
            
            await fromCrewRef.update({
              hours: newHours,
              totalAmount: newTotalAmount,
              updatedAt: new Date()
            });
            
            console.log(`✅ Decremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} from crew ${fromCrewId} (confirmed job moved away)`);
          }
        } catch (crewUpdateErr) {
          console.error('❌ Error decrementing hours/amount from source crew:', crewUpdateErr);
        }
        
        // Increment for target crew (confirmed job stays confirmed)
        try {
          const toCrewRef = db.collection('crews').doc(toCrewId);
          const toCrewDoc = await toCrewRef.get();
          
          if (toCrewDoc.exists) {
            const toCrewData = toCrewDoc.data();
            const currentHours = toCrewData.hours || 0;
            const newHours = currentHours + hours;
            
            // Calculate crew's share of the booking amount to increment
            const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
            const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
            const crewAmountShare = bookingTotalAmount / professionalsNeeded;
            
            const currentTotalAmount = parseFloat(toCrewData.totalAmount) || 0;
            const newTotalAmount = currentTotalAmount + crewAmountShare;
            
            await toCrewRef.update({
              hours: newHours,
              totalAmount: newTotalAmount,
              updatedAt: new Date()
            });
            
            console.log(`✅ Incremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} for crew ${toCrewId} (confirmed job transferred)`);
          }
        } catch (crewUpdateErr) {
          console.error('❌ Error incrementing hours/amount for target crew:', crewUpdateErr);
        }
      } else {
        console.log(`ℹ️  Job not confirmed - no hours/amount transfer needed`);
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error moving job between crews:', err);
    res.status(500).json({ error: 'Failed to move job between crews' });
  }
});

// PATCH /bookings/:id/move-multi-crew - move multi-crew job between crews
router.patch('/:id/move-multi-crew', async (req, res) => {
  try {
    const { id } = req.params;
    const { fromCrewId, toCrewId } = req.body;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
    const wasConfirmed = bookingData.assignedStatus === 'confirm';
    
    // Initialize multi-crew fields if they don't exist
    let assignedCrews = bookingData.assignedCrews || [];
    let confirmedCrews = bookingData.confirmedCrews || [];
    let professionalsAssigned = bookingData.professionalsAssigned || 0;
    let professionalsConfirmed = bookingData.professionalsConfirmed || 0;
    
    // Validate that the job is assigned to the source crew
    if (!assignedCrews.includes(fromCrewId)) {
      return res.status(400).json({ error: 'Job is not assigned to the source crew' });
    }
    
    // Check if target crew is already assigned
    if (assignedCrews.includes(toCrewId)) {
      return res.status(400).json({ error: 'Job is already assigned to the target crew' });
    }
    
    // Remove from source crew
    assignedCrews = assignedCrews.filter(id => id !== fromCrewId);
    professionalsAssigned = Math.max(0, professionalsAssigned - 1);
    
    // Check if source crew was confirmed
    const wasSourceCrewConfirmed = confirmedCrews.includes(fromCrewId);
    if (wasSourceCrewConfirmed) {
      confirmedCrews = confirmedCrews.filter(id => id !== fromCrewId);
      professionalsConfirmed = Math.max(0, professionalsConfirmed - 1);
    }
    
    // Add to target crew
    assignedCrews.push(toCrewId);
    professionalsAssigned += 1;
    
    // Multi-crew jobs: Keep confirmed status when moving confirmed crew
    if (wasSourceCrewConfirmed) {
      confirmedCrews.push(toCrewId);
      professionalsConfirmed += 1;
      console.log(`✅ Multi-crew: Transferred confirmation from ${fromCrewId} to ${toCrewId}`);
    }
    
    // Determine new status
    let newStatus = 'unassigned';
    if (professionalsAssigned > 0 && professionalsAssigned < professionalsNeeded) {
      newStatus = 'partially_assigned';
    } else if (professionalsAssigned === professionalsNeeded) {
      newStatus = 'assigned';
    }
    
    // Update the booking
    const updateData = {
      assignedCrews,
      professionalsAssigned,
      assignedStatus: newStatus,
      assignedTo: toCrewId, // Keep for backward compatibility
      confirmedCrews,
      professionalsConfirmed,
      updatedAt: new Date()
    };
    
    await bookingRef.update(updateData);
    
    // Sync assignedStatus to user's subcollection
    const userId = bookingData.userId;
    if (userId && updateData.assignedStatus) {
      console.log(`🔄 MOVE-MULTI-CREW UPDATE: Syncing status change for booking ${id}, user ${userId}, new status: ${updateData.assignedStatus}`);
      
      // Prepare additional fields to sync
      const additionalFields = {
        assignedCrews: updateData.assignedCrews,
        professionalsAssigned: updateData.professionalsAssigned,
        confirmedCrews: updateData.confirmedCrews,
        professionalsConfirmed: updateData.professionalsConfirmed,
        assignedTo: updateData.assignedTo
      };
      
      const syncSuccess = await manualSyncByCustomerId(id, userId, updateData.assignedStatus, additionalFields);
      
      if (syncSuccess) {
        console.log(`✅ MOVE-MULTI-CREW UPDATE: Successfully synced status for booking ${id}`);
      } else {
        console.warn(`⚠️ MOVE-MULTI-CREW UPDATE: Failed to sync assignedStatus for booking ${id} in user ${userId} subcollection`);
      }
    }
    
    // Handle crew hours tracking - ONLY if crews were confirmed
    if (hours > 0 && wasSourceCrewConfirmed) {
      // Decrement hours and amount from source crew (only if they were confirmed)
      try {
        const fromCrewRef = db.collection('crews').doc(fromCrewId);
        const fromCrewDoc = await fromCrewRef.get();
        
        if (fromCrewDoc.exists) {
          const fromCrewData = fromCrewDoc.data();
          const currentHours = fromCrewData.hours || 0;
          const newHours = Math.max(0, currentHours - hours);
          
          // Calculate crew's share of the booking amount to decrement
          const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
          const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
          const crewAmountShare = bookingTotalAmount / professionalsNeeded;
          
          const currentTotalAmount = parseFloat(fromCrewData.totalAmount) || 0;
          const newTotalAmount = Math.max(0, currentTotalAmount - crewAmountShare);
          
          await fromCrewRef.update({
            hours: newHours,
            totalAmount: newTotalAmount,
            updatedAt: new Date()
          });
          
          console.log(`✅ Decremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} from crew ${fromCrewId} (confirmed crew moved away)`);
        }
      } catch (crewUpdateErr) {
        console.error('Error decrementing hours/amount from source crew:', crewUpdateErr);
      }
      
      // Increment hours and amount for target crew (job stays confirmed)
      try {
        const toCrewRef = db.collection('crews').doc(toCrewId);
        const toCrewDoc = await toCrewRef.get();
        
        if (toCrewDoc.exists) {
          const toCrewData = toCrewDoc.data();
          const currentHours = toCrewData.hours || 0;
          const newHours = currentHours + hours;
          
          // Calculate crew's share of the booking amount to increment
          const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
          const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
          const crewAmountShare = bookingTotalAmount / professionalsNeeded;
          
          const currentTotalAmount = parseFloat(toCrewData.totalAmount) || 0;
          const newTotalAmount = currentTotalAmount + crewAmountShare;
          
          await toCrewRef.update({
            hours: newHours,
            totalAmount: newTotalAmount,
            updatedAt: new Date()
          });
          
          console.log(`✅ Incremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} for crew ${toCrewId} (confirmed crew transferred)`);
        }
      } catch (crewUpdateErr) {
        console.error('Error incrementing hours/amount for target crew:', crewUpdateErr);
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error moving multi-crew job between crews:', err);
    res.status(500).json({ error: 'Failed to move multi-crew job between crews' });
  }
});

// PATCH /bookings/:id/assign-crew - add a crew to multi-professional job
router.patch('/:id/assign-crew', async (req, res) => {
  try {
    const { id } = req.params;
    const { crewId } = req.body;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
    
    // Initialize multi-crew fields if they don't exist
    let assignedCrews = bookingData.assignedCrews || [];
    let professionalsAssigned = bookingData.professionalsAssigned || 0;
    let confirmedCrews = bookingData.confirmedCrews || [];
    let professionalsConfirmed = bookingData.professionalsConfirmed || 0;
    
    // If this is the first assignment, migrate from single-crew to multi-crew
    if (bookingData.assignedTo && assignedCrews.length === 0) {
      assignedCrews = [bookingData.assignedTo];
      professionalsAssigned = 1;
    }
    
    // Check if crew is already assigned
    if (assignedCrews.includes(crewId)) {
      return res.status(400).json({ error: 'Crew already assigned to this job' });
    }
    
    // Add crew to assigned crews
    assignedCrews.push(crewId);
    professionalsAssigned += 1;
    
    // Determine new status
    let newStatus = 'assigned';
    if (professionalsAssigned < professionalsNeeded) {
      newStatus = 'partially_assigned';
    } else if (professionalsAssigned === professionalsNeeded) {
      newStatus = 'assigned';
    }
    
    // If this crew was previously confirmed, unconfirm them (reassignment)
    if (confirmedCrews.includes(crewId)) {
      confirmedCrews = confirmedCrews.filter(id => id !== crewId);
      professionalsConfirmed = Math.max(0, professionalsConfirmed - 1);
      
      // Decrement crew hours since they're being unconfirmed
      if (hours > 0) {
        try {
          const crewRef = db.collection('crews').doc(crewId);
          const crewDoc = await crewRef.get();
          
          if (crewDoc.exists) {
            const crewData = crewDoc.data();
            const currentHours = crewData.hours || 0;
            const newHours = Math.max(0, currentHours - hours);
            
            await crewRef.update({
              hours: newHours,
              updatedAt: new Date()
            });
            
            console.log(`Decremented ${hours} hours for crew ${crewId} (reassignment unconfirmed)`);
          }
        } catch (crewUpdateErr) {
          console.error('Error decrementing hours for crew on reassignment:', crewUpdateErr);
        }
      }
    }
    
    // Update the booking
    const updateData = {
      assignedCrews,
      professionalsAssigned,
      assignedStatus: newStatus,
      assignedTo: crewId, // Keep for backward compatibility
      confirmedCrews,
      professionalsConfirmed,
      updatedAt: new Date()
    };
    
    await bookingRef.update(updateData);
    
    // Sync assignedStatus to user's subcollection
    const userId = bookingData.userId;
    if (userId && updateData.assignedStatus) {
      console.log(`🔄 ASSIGN-CREW UPDATE: Syncing status change for booking ${id}, user ${userId}, new status: ${updateData.assignedStatus}`);
      
      // Prepare additional fields to sync
      const additionalFields = {
        assignedCrews: updateData.assignedCrews,
        professionalsAssigned: updateData.professionalsAssigned,
        confirmedCrews: updateData.confirmedCrews,
        professionalsConfirmed: updateData.professionalsConfirmed,
        assignedTo: updateData.assignedTo
      };
      
      // Use manual sync method with customerId and additional fields
      const syncSuccess = await manualSyncByCustomerId(id, userId, updateData.assignedStatus, additionalFields);
      
      if (syncSuccess) {
        console.log(`✅ ASSIGN-CREW UPDATE: Successfully synced status for booking ${id}`);
      } else {
        console.warn(`⚠️ ASSIGN-CREW UPDATE: Failed to sync assignedStatus for booking ${id} in user ${userId} subcollection`);
      }
    }
    
    // Note: We don't increment hours here - only when status changes to 'confirmed'
    // This endpoint is only for assignment, not confirmation
    // Hours will be incremented when the job is confirmed via the confirm-crew endpoint
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error assigning crew to booking:', err);
    res.status(500).json({ error: 'Failed to assign crew to booking' });
  }
});

// PATCH /bookings/:id/unassign-crew - remove a crew from multi-professional job
router.patch('/:id/unassign-crew', async (req, res) => {
  try {
    const { id } = req.params;
    const { crewId } = req.body;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
    
    // Initialize multi-crew fields if they don't exist
    let assignedCrews = bookingData.assignedCrews || [];
    let professionalsAssigned = bookingData.professionalsAssigned || 0;
    let confirmedCrews = bookingData.confirmedCrews || [];
    let professionalsConfirmed = bookingData.professionalsConfirmed || 0;
    
    // If this is the first assignment, migrate from single-crew to multi-crew
    if (bookingData.assignedTo && assignedCrews.length === 0) {
      assignedCrews = [bookingData.assignedTo];
      professionalsAssigned = 1;
    }
    
    // Check if crew is assigned
    if (!assignedCrews.includes(crewId)) {
      return res.status(400).json({ error: 'Crew not assigned to this job' });
    }
    
    // Track if crew was confirmed (needed for hour tracking)
    const wasCrewConfirmed = confirmedCrews.includes(crewId);
    
    // Remove crew from assigned crews
    assignedCrews = assignedCrews.filter(id => id !== crewId);
    professionalsAssigned = Math.max(0, professionalsAssigned - 1);
    
    // Also remove crew from confirmed crews if they were confirmed
    if (wasCrewConfirmed) {
      confirmedCrews = confirmedCrews.filter(id => id !== crewId);
      professionalsConfirmed = Math.max(0, professionalsConfirmed - 1);
    }
    
    // Determine new status
    let newStatus = 'unassigned';
    if (professionalsAssigned > 0 && professionalsAssigned < professionalsNeeded) {
      newStatus = 'partially_assigned';
    } else if (professionalsAssigned === professionalsNeeded) {
      newStatus = 'assigned';
    }
    
    // Update the booking
    const updateData = {
      assignedCrews,
      professionalsAssigned,
      assignedStatus: newStatus,
      assignedTo: assignedCrews.length > 0 ? assignedCrews[0] : null, // Keep for backward compatibility
      confirmedCrews,
      professionalsConfirmed,
      updatedAt: new Date()
    };
    
    await bookingRef.update(updateData);
    
    // Sync assignedStatus to user's subcollection
    const userId = bookingData.userId;
    if (userId && updateData.assignedStatus) {
      console.log(`🔄 UNASSIGN-CREW UPDATE: Syncing status change for booking ${id}, user ${userId}, new status: ${updateData.assignedStatus}`);
      
      // Prepare additional fields to sync
      const additionalFields = {
        assignedCrews: updateData.assignedCrews,
        professionalsAssigned: updateData.professionalsAssigned,
        confirmedCrews: updateData.confirmedCrews,
        professionalsConfirmed: updateData.professionalsConfirmed,
        assignedTo: updateData.assignedTo
      };
      
      // Use manual sync method with customerId and additional fields
      const syncSuccess = await manualSyncByCustomerId(id, userId, updateData.assignedStatus, additionalFields);
      
      if (syncSuccess) {
        console.log(`✅ UNASSIGN-CREW UPDATE: Successfully synced status for booking ${id}`);
      } else {
        console.warn(`⚠️ UNASSIGN-CREW UPDATE: Failed to sync assignedStatus for booking ${id} in user ${userId} subcollection`);
      }
    }
    
    // Decrement crew hours ONLY if the crew was confirmed
    if (hours > 0 && wasCrewConfirmed) {
      try {
        const crewRef = db.collection('crews').doc(crewId);
        const crewDoc = await crewRef.get();
        
        if (crewDoc.exists) {
          const crewData = crewDoc.data();
          const currentHours = crewData.hours || 0;
          const newHours = Math.max(0, currentHours - hours);
          
          await crewRef.update({
            hours: newHours,
            updatedAt: new Date()
          });
          
          console.log(`✅ Decremented ${hours} hours from crew ${crewId} (confirmed crew unassigned)`);
        }
      } catch (crewUpdateErr) {
        console.error('❌ Error decrementing hours from crew:', crewUpdateErr);
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error unassigning crew from booking:', err);
    res.status(500).json({ error: 'Failed to unassign crew from booking' });
  }
});

// PATCH /bookings/:id/confirm-crew - confirm individual crew (works for both single and multi-crew jobs)
router.patch('/:id/confirm-crew', async (req, res) => {
  try {
    const { id } = req.params;
    const { crewId } = req.body;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
    const assignedTo = bookingData.assignedTo;
    const assignedCrews = bookingData.assignedCrews || [];
    const confirmedCrews = bookingData.confirmedCrews || [];
    
    console.log(`🔍 CONFIRM-CREW: Job ${id}, crewId ${crewId}`);
    console.log(`   professionals=${professionalsNeeded}, assignedTo=${assignedTo}, assignedCrews=${JSON.stringify(assignedCrews)}`);
    
    // For single-crew jobs, check assignedTo (assignedCrews may not exist for old bookings)
    const isSingleCrewJob = professionalsNeeded === 1;
    
    if (isSingleCrewJob) {
      // Single-crew job: check if assigned to this crew
      if (assignedTo !== crewId) {
        console.error(`❌ Single-crew job ${id} not assigned to crew ${crewId} (assignedTo=${assignedTo})`);
        return res.status(400).json({ error: 'Crew not assigned to this job' });
      }
      
      // Check if already confirmed (status is 'confirm')
      if (bookingData.assignedStatus === 'confirm') {
        return res.status(400).json({ error: 'Job already confirmed' });
      }
      
      // Change status to 'confirm' for single-crew jobs
      await bookingRef.update({
        assignedStatus: 'confirm',
        updatedAt: new Date()
      });
      
      console.log(`✅ CONFIRM-CREW: Single-crew job ${id} status changed to 'confirm'`);
    } else {
      // Multi-crew job: use assignedCrews array
      if (!assignedCrews.includes(crewId)) {
        return res.status(400).json({ error: 'Crew not assigned to this job' });
      }
      
      // Check if crew is already confirmed
      if (confirmedCrews.includes(crewId)) {
        return res.status(400).json({ error: 'Crew already confirmed for this job' });
      }
      
      // Add crew to confirmed crews
      const newConfirmedCrews = [...confirmedCrews, crewId];
      
      // Update the booking
      await bookingRef.update({
        confirmedCrews: newConfirmedCrews,
        professionalsConfirmed: newConfirmedCrews.length,
        updatedAt: new Date()
      });
      
      console.log(`✅ CONFIRM-CREW: Multi-crew job ${id} - added crew ${crewId} to confirmed crews`);
    }
    
    // Increment crew hours for this specific crew
    if (hours > 0) {
      try {
        const crewRef = db.collection('crews').doc(crewId);
        const crewDoc = await crewRef.get();
        
        if (crewDoc.exists) {
          const crewData = crewDoc.data();
          const currentHours = crewData.hours || 0;
          const newHours = currentHours + hours;
          
          // Calculate crew's share of the booking amount
          const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
          const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
          const crewAmountShare = bookingTotalAmount / professionalsNeeded;
          
          // Initialize totalAmount if it doesn't exist
          const currentTotalAmount = parseFloat(crewData.totalAmount) || 0;
          const newTotalAmount = currentTotalAmount + crewAmountShare;
          
          await crewRef.update({
            hours: newHours,
            totalAmount: newTotalAmount,
            updatedAt: new Date()
          });
          
          console.log(`✅ CONFIRM-CREW: Incremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} for crew ${crewId}`);
          console.log(`   - Booking totalAmount: ${bookingTotalAmount}, Professionals: ${professionalsNeeded}`);
          console.log(`   - Crew totalAmount: ${currentTotalAmount} → ${newTotalAmount}`);
        }
      } catch (crewUpdateErr) {
        console.error('❌ Error incrementing hours/amount for crew:', crewUpdateErr);
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error confirming crew for booking:', err);
    res.status(500).json({ error: 'Failed to confirm crew for booking' });
  }
});

// PATCH /bookings/:id/unconfirm-crew - unconfirm individual crew (works for both single and multi-crew jobs)
router.patch('/:id/unconfirm-crew', async (req, res) => {
  try {
    const { id } = req.params;
    const { crewId } = req.body;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
    const assignedTo = bookingData.assignedTo;
    const assignedCrews = bookingData.assignedCrews || [];
    const confirmedCrews = bookingData.confirmedCrews || [];
    
    console.log(`🔍 UNCONFIRM-CREW: Job ${id}, crewId ${crewId}`);
    console.log(`   professionals=${professionalsNeeded}, assignedTo=${assignedTo}, assignedCrews=${JSON.stringify(assignedCrews)}`);
    
    // For single-crew jobs, check assignedTo (assignedCrews may not exist for old bookings)
    const isSingleCrewJob = professionalsNeeded === 1;
    
    if (isSingleCrewJob) {
      // Single-crew job: check if assigned to this crew
      if (assignedTo !== crewId) {
        console.error(`❌ Single-crew job ${id} not assigned to crew ${crewId} (assignedTo=${assignedTo})`);
        return res.status(400).json({ error: 'Crew not assigned to this job' });
      }
      
      // Check if confirmed (status is 'confirm')
      if (bookingData.assignedStatus !== 'confirm') {
        return res.status(400).json({ error: 'Job not confirmed' });
      }
      
      // Change status back to 'assigned' for single-crew jobs
      await bookingRef.update({
        assignedStatus: 'assigned',
        updatedAt: new Date()
      });
      
      console.log(`✅ UNCONFIRM-CREW: Single-crew job ${id} status changed to 'assigned'`);
    } else {
      // Multi-crew job: use confirmedCrews array
      if (!confirmedCrews.includes(crewId)) {
        return res.status(400).json({ error: 'Crew not confirmed for this job' });
      }
      
      // Remove crew from confirmed crews
      const newConfirmedCrews = confirmedCrews.filter(id => id !== crewId);
      
      // Update the booking
      await bookingRef.update({
        confirmedCrews: newConfirmedCrews,
        professionalsConfirmed: newConfirmedCrews.length,
        updatedAt: new Date()
      });
      
      console.log(`✅ UNCONFIRM-CREW: Multi-crew job ${id} - removed crew ${crewId} from confirmed crews`);
    }
    
    // Decrement crew hours for this specific crew
    if (hours > 0) {
      try {
        const crewRef = db.collection('crews').doc(crewId);
        const crewDoc = await crewRef.get();
        
        if (crewDoc.exists) {
          const crewData = crewDoc.data();
          const currentHours = crewData.hours || 0;
          const newHours = Math.max(0, currentHours - hours);
          
          // Calculate crew's share of the booking amount to decrement
          const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
          const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
          const crewAmountShare = bookingTotalAmount / professionalsNeeded;
          
          const currentTotalAmount = parseFloat(crewData.totalAmount) || 0;
          const newTotalAmount = Math.max(0, currentTotalAmount - crewAmountShare);
          
          await crewRef.update({
            hours: newHours,
            totalAmount: newTotalAmount,
            updatedAt: new Date()
          });
          
          console.log(`Decremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} for crew ${crewId} (individual crew unconfirmed)`);
        }
      } catch (crewUpdateErr) {
        console.error('Error decrementing hours/amount for crew:', crewUpdateErr);
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error unconfirming crew for booking:', err);
    res.status(500).json({ error: 'Failed to unconfirm crew for booking' });
  }
});

// PATCH /bookings/:id/move-to-unassigned - move assigned job back to unassigned
router.patch('/:id/move-to-unassigned', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const assignedTo = bookingData.assignedTo;
    const assignedCrews = bookingData.assignedCrews || [];
    const confirmedCrews = bookingData.confirmedCrews || [];
    
    // Update the booking to unassigned
    await bookingRef.update({
      assignedTo: null,
      assignedCrews: [],
      professionalsAssigned: 0,
      confirmedCrews: [],
      assignedStatus: 'unassigned',
      updatedAt: new Date()
    });
    
    // Decrement crew hours and amount for all confirmed crews
    const crewsToUpdate = assignedCrews.length > 0 ? assignedCrews : (assignedTo ? [assignedTo] : []);
    
    for (const crewId of crewsToUpdate) {
      // Only decrement hours/amount if the crew was confirmed
      const wasConfirmed = confirmedCrews.includes(crewId);
      
      if (hours > 0 && wasConfirmed) {
        try {
          const crewRef = db.collection('crews').doc(crewId);
          const crewDoc = await crewRef.get();
          
          if (crewDoc.exists) {
            const crewData = crewDoc.data();
            const currentHours = crewData.hours || 0;
            const newHours = Math.max(0, currentHours - hours);
            
            // Calculate crew's share of the booking amount to decrement
            const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
            const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
            const crewAmountShare = bookingTotalAmount / professionalsNeeded;
            
            const currentTotalAmount = parseFloat(crewData.totalAmount) || 0;
            const newTotalAmount = Math.max(0, currentTotalAmount - crewAmountShare);
            
            await crewRef.update({
              hours: newHours,
              totalAmount: newTotalAmount,
              updatedAt: new Date()
            });
            
            console.log(`Decremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} from crew ${crewId} (moved to unassigned)`);
          }
        } catch (crewUpdateErr) {
          console.error(`Error decrementing hours/amount from crew ${crewId}:`, crewUpdateErr);
          // Don't fail the booking update if crew update fails
        }
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error moving booking to unassigned:', err);
    res.status(500).json({ error: 'Failed to move booking to unassigned' });
  }
});

// PATCH /bookings/:id/cancel-and-move-to-unassigned - cancel confirmed job and move to unassigned
router.patch('/:id/cancel-and-move-to-unassigned', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const assignedTo = bookingData.assignedTo;
    const assignedCrews = bookingData.assignedCrews || [];
    const confirmedCrews = bookingData.confirmedCrews || [];
    
    // Update the booking to unassigned
    await bookingRef.update({
      assignedTo: null,
      assignedCrews: [],
      professionalsAssigned: 0,
      confirmedCrews: [],
      assignedStatus: 'unassigned',
      updatedAt: new Date()
    });
    
    // Decrement crew hours and amount for all confirmed crews
    const crewsToUpdate = assignedCrews.length > 0 ? assignedCrews : (assignedTo ? [assignedTo] : []);
    
    for (const crewId of crewsToUpdate) {
      // Only decrement hours/amount if the crew was confirmed
      const wasConfirmed = confirmedCrews.includes(crewId);
      
      if (hours > 0 && wasConfirmed) {
        try {
          const crewRef = db.collection('crews').doc(crewId);
          const crewDoc = await crewRef.get();
          
          if (crewDoc.exists) {
            const crewData = crewDoc.data();
            const currentHours = crewData.hours || 0;
            const newHours = Math.max(0, currentHours - hours);
            
            // Calculate crew's share of the booking amount to decrement
            const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
            const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
            const crewAmountShare = bookingTotalAmount / professionalsNeeded;
            
            const currentTotalAmount = parseFloat(crewData.totalAmount) || 0;
            const newTotalAmount = Math.max(0, currentTotalAmount - crewAmountShare);
            
            await crewRef.update({
              hours: newHours,
              totalAmount: newTotalAmount,
              updatedAt: new Date()
            });
            
            console.log(`Decremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} from crew ${crewId} (cancelled job)`);
          }
        } catch (crewUpdateErr) {
          console.error(`Error decrementing hours/amount from crew ${crewId}:`, crewUpdateErr);
          // Don't fail the booking update if crew update fails
        }
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error cancelling and moving booking to unassigned:', err);
    res.status(500).json({ error: 'Failed to cancel and move booking to unassigned' });
  }
});

// PATCH /bookings/:id/soft-delete - soft delete a booking (set status to "drop")
router.patch('/:id/soft-delete', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const assignedTo = bookingData.assignedTo;
    const assignedCrews = bookingData.assignedCrews || [];
    const confirmedCrews = bookingData.confirmedCrews || [];
    
    // Update the booking status to "drop"
    await bookingRef.update({
      assignedStatus: 'drop',
      updatedAt: new Date()
    });
    
    // Decrement crew hours and amount for all confirmed crews
    const crewsToUpdate = assignedCrews.length > 0 ? assignedCrews : (assignedTo ? [assignedTo] : []);
    
    for (const crewId of crewsToUpdate) {
      // Only decrement hours/amount if the crew was confirmed
      const wasConfirmed = confirmedCrews.includes(crewId);
      
      if (hours > 0 && wasConfirmed) {
        try {
          const crewRef = db.collection('crews').doc(crewId);
          const crewDoc = await crewRef.get();
          
          if (crewDoc.exists) {
            const crewData = crewDoc.data();
            const currentHours = crewData.hours || 0;
            const newHours = Math.max(0, currentHours - hours);
            
            // Calculate crew's share of the booking amount to decrement
            const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
            const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
            const crewAmountShare = bookingTotalAmount / professionalsNeeded;
            
            const currentTotalAmount = parseFloat(crewData.totalAmount) || 0;
            const newTotalAmount = Math.max(0, currentTotalAmount - crewAmountShare);
            
            await crewRef.update({
              hours: newHours,
              totalAmount: newTotalAmount,
              updatedAt: new Date()
            });
            
            console.log(`Decremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} from crew ${crewId} (soft deleted job)`);
          }
        } catch (crewUpdateErr) {
          console.error(`Error decrementing hours/amount from crew ${crewId}:`, crewUpdateErr);
          // Don't fail the booking update if crew update fails
        }
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error soft deleting booking:', err);
    res.status(500).json({ error: 'Failed to soft delete booking' });
  }
});

// PATCH /bookings/:id/unassign - unassign a booking (move back to unassigned)
router.patch('/:id/unassign', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    // Update the booking to unassigned
    await bookingRef.update({
      assignedTo: null,
      assignedStatus: 'unassigned',
      updatedAt: new Date()
    });
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error unassigning booking:', err);
    res.status(500).json({ error: 'Failed to unassign booking' });
  }
});

// PATCH /bookings/:id - update specific booking fields
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const hours = parseInt(bookingData.hours, 10) || 0;
    const assignedTo = bookingData.assignedTo;
    const assignedCrews = bookingData.assignedCrews || [];
    const previousStatus = bookingData.assignedStatus;
    const newStatus = updateData.assignedStatus;
    
    console.log(`🔍 PATCH /bookings/${id} - Status change: ${previousStatus} → ${newStatus}`);
    console.log(`   Booking data: hours=${hours}, assignedTo=${assignedTo}, assignedCrews=${JSON.stringify(assignedCrews)}`);
    console.log(`   totalAmount=${bookingData.totalAmount}, professionals=${bookingData.professionals}`);
    
    // Update the booking with provided fields
    await bookingRef.update({
      ...updateData,
      updatedAt: new Date()
    });
    
    // Handle crew hours tracking when status changes to 'confirmed'
    if (hours > 0 && newStatus === 'confirm' && previousStatus !== 'confirm') {
      // For multi-crew jobs, increment hours for all assigned crews
      const crewsToUpdate = assignedCrews.length > 0 ? assignedCrews : (assignedTo ? [assignedTo] : []);
      
      console.log(`✅ Confirming job - will update crews: ${JSON.stringify(crewsToUpdate)}`);
      console.log(`   DEBUG: assignedCrews=${JSON.stringify(assignedCrews)}, assignedTo=${assignedTo}, crewsToUpdate.length=${crewsToUpdate.length}`);
      
      if (crewsToUpdate.length === 0) {
        console.warn(`⚠️  WARNING: No crews to update! Booking ${id} has no assignedTo or assignedCrews`);
      }
      
      for (const crewId of crewsToUpdate) {
        try {
          const crewRef = db.collection('crews').doc(crewId);
          const crewDoc = await crewRef.get();
          
          if (!crewDoc.exists) {
            console.error(`❌ ERROR: Crew ${crewId} not found in database!`);
            continue;
          }
          
          if (crewDoc.exists) {
            const crewData = crewDoc.data();
            const currentHours = crewData.hours || 0;
            const newHours = currentHours + hours;
            
            // Calculate crew's share of the booking amount
            const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
            const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
            const crewAmountShare = bookingTotalAmount / professionalsNeeded;
            
            if (bookingTotalAmount === 0) {
              console.warn(`⚠️  WARNING: Booking ${id} has totalAmount = 0, crew will not get any amount increment`);
            }
            
            const currentTotalAmount = parseFloat(crewData.totalAmount) || 0;
            const newTotalAmount = currentTotalAmount + crewAmountShare;
            
            console.log(`   💰 Crew ${crewId}: hours ${currentHours} → ${newHours}, amount ${currentTotalAmount.toFixed(2)} → ${newTotalAmount.toFixed(2)} (+${crewAmountShare.toFixed(2)})`);
            
            await crewRef.update({
              hours: newHours,
              totalAmount: newTotalAmount,
              updatedAt: new Date()
            });
            
            console.log(`✅ Incremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} for crew ${crewId} (job confirmed via PATCH)`);
          }
        } catch (crewUpdateErr) {
          console.error(`❌ Error incrementing hours/amount for crew ${crewId} on confirmation:`, crewUpdateErr);
          // Don't fail the booking update if crew update fails
        }
      }
    }
    
    // Handle crew hours decrement when status changes from 'confirm' to something else
    if (hours > 0 && previousStatus === 'confirm' && newStatus !== 'confirm') {
      // For multi-crew jobs, decrement hours for all assigned crews
      const crewsToUpdate = assignedCrews.length > 0 ? assignedCrews : (assignedTo ? [assignedTo] : []);
      
      for (const crewId of crewsToUpdate) {
        try {
          const crewRef = db.collection('crews').doc(crewId);
          const crewDoc = await crewRef.get();
          
          if (crewDoc.exists) {
            const crewData = crewDoc.data();
            const currentHours = crewData.hours || 0;
            const newHours = Math.max(0, currentHours - hours);
            
            // Calculate crew's share of the booking amount to decrement
            const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
            const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
            const crewAmountShare = bookingTotalAmount / professionalsNeeded;
            
            const currentTotalAmount = parseFloat(crewData.totalAmount) || 0;
            const newTotalAmount = Math.max(0, currentTotalAmount - crewAmountShare);
            
            await crewRef.update({
              hours: newHours,
              totalAmount: newTotalAmount,
              updatedAt: new Date()
            });
            
            console.log(`✅ Decremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} from crew ${crewId} (job unconfirmed via PATCH)`);
          }
        } catch (crewUpdateErr) {
          console.error(`❌ Error decrementing hours/amount for crew ${crewId} on unconfirmation:`, crewUpdateErr);
          // Don't fail the booking update if crew update fails
        }
      }
    }
    
    // Get the updated booking
    const updatedDoc = await bookingRef.get();
    const updatedBooking = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedBooking);
  } catch (err) {
    console.error('Error updating booking:', err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// DELETE /bookings/:id - delete a booking
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate that the booking exists
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const userId = bookingData.userId;
    const totalAmount = parseFloat(bookingData.totalAmount) || 0;
    const paymentStatus = bookingData.paymentStatus || 'due';
    const dueBalance = bookingData.dueBalance !== undefined ? parseFloat(bookingData.dueBalance) : totalAmount;
    
    console.log(`Deleting booking ${id}:`, {
      userId,
      totalAmount,
      paymentStatus,
      dueBalance
    });
    
    // Update user's financial fields
    if (userId) {
      try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          const updateFields = {};
          
          // Calculate how much was paid (totalAmount - dueBalance)
          const paidAmount = totalAmount - dueBalance;
          
          // Decrement totalAmount by the amount that was paid
          if (paidAmount > 0) {
            const currentTotalAmount = userData.totalAmount || 0;
            const newTotalAmount = Math.max(0, currentTotalAmount - paidAmount);
            updateFields.totalAmount = newTotalAmount;
            console.log(`Decrementing user ${userId} totalAmount: ${currentTotalAmount} - ${paidAmount} = ${newTotalAmount}`);
          }
          
          // Decrement dueAmount by the remaining due balance
          if (dueBalance > 0) {
            const currentDueAmount = userData.dueAmount || 0;
            const newDueAmount = Math.max(0, currentDueAmount - dueBalance);
            updateFields.dueAmount = newDueAmount;
            console.log(`Decrementing user ${userId} dueAmount: ${currentDueAmount} - ${dueBalance} = ${newDueAmount}`);
          }
          
          if (Object.keys(updateFields).length > 0) {
            await userRef.update(updateFields);
            console.log(`Updated user ${userId} financial fields:`, updateFields);
          }
        } else {
          console.warn(`User ${userId} not found, skipping financial update`);
        }
      } catch (userUpdateErr) {
        console.error('Error updating user financial fields:', userUpdateErr);
        // Continue with deletion even if user update fails
      }
      
      // Delete mirrored booking from user's subcollection
      try {
        const mirroredBookingRef = db.collection('users').doc(userId).collection('bookings').doc(id);
        const mirroredDoc = await mirroredBookingRef.get();
        
        if (mirroredDoc.exists) {
          await mirroredBookingRef.delete();
          console.log(`Deleted mirrored booking ${id} from user ${userId} subcollection`);
        } else {
          console.warn(`Mirrored booking ${id} not found in user ${userId} subcollection`);
        }
      } catch (mirrorDeleteErr) {
        console.error('Error deleting mirrored booking:', mirrorDeleteErr);
        // Continue with deletion even if mirror delete fails
      }
    }
    
    // Handle user hours decrement if booking was paid
    if (userId && bookingData.hours) {
      const hoursValue = parseInt(bookingData.hours, 10);
      
      await handleBookingDeletionHours(userId, hoursValue, paymentStatus, id);
    }
    
    // Handle crew hours and amount decrement if booking was confirmed
    const hours = parseInt(bookingData.hours, 10) || 0;
    const assignedTo = bookingData.assignedTo;
    const assignedCrews = bookingData.assignedCrews || [];
    const confirmedCrews = bookingData.confirmedCrews || [];
    const assignedStatus = bookingData.assignedStatus;
    
    // Decrement crew hours and amount if the booking was confirmed
    if (hours > 0 && (assignedStatus === 'confirm' || confirmedCrews.length > 0)) {
      const crewsToUpdate = assignedCrews.length > 0 ? assignedCrews : (assignedTo ? [assignedTo] : []);
      
      for (const crewId of crewsToUpdate) {
        // Only decrement if the crew was confirmed
        const wasConfirmed = confirmedCrews.includes(crewId) || assignedStatus === 'confirm';
        
        if (wasConfirmed) {
          try {
            const crewRef = db.collection('crews').doc(crewId);
            const crewDoc = await crewRef.get();
            
            if (crewDoc.exists) {
              const crewData = crewDoc.data();
              const currentHours = crewData.hours || 0;
              const newHours = Math.max(0, currentHours - hours);
              
              // Calculate crew's share of the booking amount to decrement
              const bookingTotalAmount = parseFloat(bookingData.totalAmount) || 0;
              const professionalsNeeded = parseInt(bookingData.professionals, 10) || 1;
              const crewAmountShare = bookingTotalAmount / professionalsNeeded;
              
              const currentTotalAmount = parseFloat(crewData.totalAmount) || 0;
              const newTotalAmount = Math.max(0, currentTotalAmount - crewAmountShare);
              
              await crewRef.update({
                hours: newHours,
                totalAmount: newTotalAmount,
                updatedAt: new Date()
              });
              
              console.log(`✅ Decremented ${hours} hours and AED ${crewAmountShare.toFixed(2)} from crew ${crewId} (booking deleted)`);
            } else {
              console.warn(`⚠️ Crew ${crewId} not found when trying to decrement hours on booking deletion`);
            }
          } catch (crewUpdateErr) {
            console.error(`❌ Error decrementing hours/amount from crew ${crewId} on booking deletion:`, crewUpdateErr);
            // Continue with deletion even if crew update fails
          }
        }
      }
    }
    
    // Delete the booking from main collection
    await bookingRef.delete();
    console.log(`Deleted booking ${id} from main collection`);
    
    res.json({ 
      success: true, 
      message: 'Booking deleted successfully and financial records updated' 
    });
  } catch (err) {
    console.error('Error deleting booking:', err);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// POST /bookings/archive - archive old bookings
router.post('/archive', async (req, res) => {
  try {
    const { type, days } = req.body;
    
    if (!days || isNaN(parseInt(days)) || parseInt(days) < 1) {
      return res.status(400).json({ error: 'Valid days parameter is required' });
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
    
    console.log(`Archiving bookings with service date older than: ${cutoffDate.toISOString()}`);
    
    // Query bookings where the service date is older than the cutoff date
    const snapshot = await db.collection('bookings')
      .where('date', '<', cutoffDate.toISOString().split('T')[0])
      .get();
    
    if (snapshot.empty) {
      return res.json({ 
        success: true, 
        message: `No bookings found older than ${days} days`,
        archivedCount: 0 
      });
    }
    
    const batch = db.batch();
    const archivedBookings = [];
    
    snapshot.docs.forEach(doc => {
      const bookingData = doc.data();
      
      // Add to archivedBookings collection
      const archivedRef = db.collection('archivedBookings').doc(doc.id);
      batch.set(archivedRef, {
        ...bookingData,
        archivedAt: new Date(),
        originalId: doc.id,
        archiveReason: type === 'manual' ? 'manual_archive' : 'auto_archive'
      });
      
      // Delete from bookings collection
      batch.delete(doc.ref);
      
      archivedBookings.push({
        id: doc.id,
        date: bookingData.date,
        assignedStatus: bookingData.assignedStatus
      });
    });
    
    // Commit the batch
    await batch.commit();
    
    console.log(`Successfully archived ${archivedBookings.length} bookings`);
    
    res.json({
      success: true,
      message: `Successfully archived ${archivedBookings.length} bookings older than ${days} days`,
      archivedCount: archivedBookings.length,
      archivedBookings: archivedBookings
    });
    
  } catch (err) {
    console.error('Error archiving bookings:', err);
    res.status(500).json({ error: 'Failed to archive bookings' });
  }
});

// GET /bookings/archive-status - get archive configuration and status
router.get('/archive-status', async (req, res) => {
  try {
    // Get archive configuration from a settings collection
    const settingsRef = db.collection('settings').doc('archive');
    const settingsDoc = await settingsRef.get();
    
    let archiveSettings = {
      autoArchive: false,
      autoArchiveDays: 30,
      lastAutoArchive: null
    };
    
    if (settingsDoc.exists) {
      archiveSettings = { ...archiveSettings, ...settingsDoc.data() };
    }
    
    // Get count of bookings that would be archived
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - archiveSettings.autoArchiveDays);
    
    const snapshot = await db.collection('bookings')
      .where('date', '<', cutoffDate.toISOString().split('T')[0])
      .get();
    
    res.json({
      ...archiveSettings,
      pendingArchiveCount: snapshot.size
    });
    
  } catch (err) {
    console.error('Error getting archive status:', err);
    res.status(500).json({ error: 'Failed to get archive status' });
  }
});

// POST /bookings/archive-config - update archive configuration
router.post('/archive-config', async (req, res) => {
  try {
    const { autoArchive, autoArchiveDays } = req.body;
    
    if (autoArchiveDays && (isNaN(parseInt(autoArchiveDays)) || parseInt(autoArchiveDays) < 1)) {
      return res.status(400).json({ error: 'Valid autoArchiveDays parameter is required' });
    }
    
    const settingsRef = db.collection('settings').doc('archive');
    await settingsRef.set({
      autoArchive: autoArchive || false,
      autoArchiveDays: autoArchiveDays || 30,
      updatedAt: new Date()
    }, { merge: true });
    
    // Trigger immediate check of auto-archive setting
    const scheduledTasks = require('../scheduledTasks');
    await scheduledTasks.checkAutoArchiveSetting();
    
    res.json({
      success: true,
      message: 'Archive configuration updated successfully',
      config: {
        autoArchive: autoArchive || false,
        autoArchiveDays: autoArchiveDays || 30
      }
    });
    
  } catch (err) {
    console.error('Error updating archive configuration:', err);
    res.status(500).json({ error: 'Failed to update archive configuration' });
  }
});

// GET /archivedBookings - get archived bookings (for viewing archived data)
router.get('/archived', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const snapshot = await db.collection('archivedBookings')
      .orderBy('archivedAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();
    
    const archivedBookings = snapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));
    
    // Fetch additional data for each booking
    const enrichedBookings = await Promise.all(
      archivedBookings.map(async (booking) => {
        const enrichedBooking = { ...booking };
        
        console.log('Processing booking:', booking.id, 'userId:', booking.userId, 'assignedTo:', booking.assignedTo);
        
        // Fetch customer name if userId exists
        if (booking.userId) {
          try {
            const userDoc = await db.collection('users').doc(booking.userId).get();
            if (userDoc.exists) {
              const userData = userDoc.data();
              enrichedBooking.customerName = userData.name || 'Unknown Customer';
              console.log(`Found customer for ${booking.userId}:`, userData.name);
            } else {
              enrichedBooking.customerName = 'Customer Not Found';
              console.log(`Customer not found for ID: ${booking.userId}`);
            }
          } catch (error) {
            console.error(`Error fetching user ${booking.userId}:`, error);
            enrichedBooking.customerName = 'Error Loading Customer';
          }
        } else {
          enrichedBooking.customerName = 'No Customer ID';
          console.log('No userId found in booking');
        }
        
        // Fetch crew name if assignedTo exists
        if (booking.assignedTo) {
          try {
            const crewDoc = await db.collection('crews').doc(booking.assignedTo).get();
            if (crewDoc.exists) {
              const crewData = crewDoc.data();
              enrichedBooking.crewName = crewData.name || 'Unknown Crew';
              console.log(`Found crew for ${booking.assignedTo}:`, crewData.name);
            } else {
              enrichedBooking.crewName = 'Crew Not Found';
              console.log(`Crew not found for ID: ${booking.assignedTo}`);
            }
          } catch (error) {
            console.error(`Error fetching crew ${booking.assignedTo}:`, error);
            enrichedBooking.crewName = 'Error Loading Crew';
          }
        } else {
          enrichedBooking.crewName = 'Not Assigned';
          console.log('No assignedTo found in booking');
        }
        
        console.log('Enriched booking:', enrichedBooking);
        return enrichedBooking;
      })
    );
    
    res.json({
      archivedBookings: enrichedBookings,
      total: enrichedBookings.length,
      hasMore: enrichedBookings.length === parseInt(limit)
    });
    
  } catch (err) {
    console.error('Error fetching archived bookings:', err);
    res.status(500).json({ error: 'Failed to fetch archived bookings' });
  }
});

// POST /bookings/:id/repair - repair a missing mirrored booking
router.post('/:id/repair', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    const success = await repairMirroredBooking(id, userId);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `Repaired mirrored booking ${id} for user ${userId}` 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to repair mirrored booking' 
      });
    }
  } catch (err) {
    console.error('Error repairing mirrored booking:', err);
    res.status(500).json({ error: 'Failed to repair mirrored booking' });
  }
});

// GET /bookings/:id/validate - validate booking synchronization
router.get('/:id/validate', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }
    
    const validation = await validateBookingSync(id, userId);
    res.json(validation);
  } catch (err) {
    console.error('Error validating booking sync:', err);
    res.status(500).json({ error: 'Failed to validate booking synchronization' });
  }
});

// GET /bookings/:id/sync-status - get synchronization status
router.get('/:id/sync-status', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }
    
    const syncStatus = await getSyncStatus(id, userId);
    res.json(syncStatus);
  } catch (err) {
    console.error('Error getting sync status:', err);
    res.status(500).json({ error: 'Failed to get synchronization status' });
  }
});

// POST /bookings/:id/force-sync - force synchronization of booking data
router.post('/:id/force-sync', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    const success = await forceSyncBooking(id, userId);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `Force synced booking ${id} for user ${userId}` 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to force sync booking' 
      });
    }
  } catch (err) {
    console.error('Error force syncing booking:', err);
    res.status(500).json({ error: 'Failed to force sync booking' });
  }
});

// POST /bookings/:id/sync-status - manually sync assignedStatus
router.post('/:id/sync-status', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, assignedStatus } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    if (!assignedStatus) {
      return res.status(400).json({ error: 'assignedStatus is required' });
    }
    
    const success = await syncAssignedStatus(id, userId, assignedStatus);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `Synced assignedStatus '${assignedStatus}' for booking ${id}` 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to sync assignedStatus' 
      });
    }
  } catch (err) {
    console.error('Error syncing assignedStatus:', err);
    res.status(500).json({ error: 'Failed to sync assignedStatus' });
  }
});

// POST /bookings/:id/manual-sync - manual sync using customerId
router.post('/:id/manual-sync', async (req, res) => {
  try {
    const { id } = req.params;
    const { customerId, assignedStatus } = req.body;
    
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    
    if (!assignedStatus) {
      return res.status(400).json({ error: 'assignedStatus is required' });
    }
    
    console.log(`🚀 MANUAL SYNC API: bookingId=${id}, customerId=${customerId}, status=${assignedStatus}`);
    
    const success = await manualSyncByCustomerId(id, customerId, assignedStatus);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `Manual synced assignedStatus '${assignedStatus}' for booking ${id} using customerId ${customerId}` 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to manual sync assignedStatus' 
      });
    }
  } catch (err) {
    console.error('Error manual syncing assignedStatus:', err);
    res.status(500).json({ error: 'Failed to manual sync assignedStatus' });
  }
});

// POST /bookings/:id/find-and-sync - find and sync user booking by customerId
router.post('/:id/find-and-sync', async (req, res) => {
  try {
    const { id } = req.params;
    const { customerId, assignedStatus } = req.body;
    
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    
    if (!assignedStatus) {
      return res.status(400).json({ error: 'assignedStatus is required' });
    }
    
    const result = await findAndSyncUserBooking(id, customerId, assignedStatus);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    console.error('Error finding and syncing booking:', err);
    res.status(500).json({ error: 'Failed to find and sync booking' });
  }
});

// GET /bookings/:id/manual-sync-status - get manual sync status by customerId
router.get('/:id/manual-sync-status', async (req, res) => {
  try {
    const { id } = req.params;
    const { customerId } = req.query;
    
    if (!customerId) {
      return res.status(400).json({ error: 'customerId query parameter is required' });
    }
    
    const syncStatus = await getManualSyncStatus(id, customerId);
    res.json(syncStatus);
  } catch (err) {
    console.error('Error getting manual sync status:', err);
    res.status(500).json({ error: 'Failed to get manual sync status' });
  }
});

// POST /bookings/sync-customer - sync all bookings for a customer
router.post('/sync-customer', async (req, res) => {
  try {
    const { customerId, assignedStatus } = req.body;
    
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    
    if (!assignedStatus) {
      return res.status(400).json({ error: 'assignedStatus is required' });
    }
    
    const result = await syncAllCustomerBookings(customerId, assignedStatus);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    console.error('Error syncing customer bookings:', err);
    res.status(500).json({ error: 'Failed to sync customer bookings' });
  }
});

// DELETE /bookings/:id - delete a booking and its mirrored copy
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the booking to find the userId
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    const userId = bookingData.userId;
    
    // Delete from main collection
    await bookingRef.delete();
    console.log(`Deleted booking ${id} from main collection`);
    
    // Delete mirrored booking if userId exists
    if (userId) {
      const deleteSuccess = await deleteMirroredBooking(id, userId);
      if (!deleteSuccess) {
        console.warn(`⚠️ Failed to delete mirrored booking ${id} from user ${userId} subcollection`);
      }
    }
    
    res.json({ 
      success: true, 
      message: `Deleted booking ${id} and its mirrored copy` 
    });
  } catch (err) {
    console.error('Error deleting booking:', err);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// POST /bookings/:id/copy - copy a booking as a template
router.post('/:id/copy', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the booking to copy
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const bookingData = bookingDoc.data();
    
    // Get customer name from users collection
    let customerName = 'Unknown Customer';
    if (bookingData.userId) {
      const userRef = db.collection('users').doc(bookingData.userId);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        customerName = userData.name || userData.email || 'Unknown Customer';
      }
    }
    
    // Prepare copied job template (exclude date, time, payment fields, assignment fields)
    const copiedJob = {
      // Customer info
      userId: bookingData.userId,
      customerName: customerName,
      email: bookingData.email || '',
      mobile: bookingData.mobile || '',
      countryCode: bookingData.countryCode || '',
      
      // Service details
      service: bookingData.service || '',
      serviceType: bookingData.serviceType || '',
      serviceCategory: bookingData.serviceCategory || '',
      
      // Location
      location: bookingData.location || '',
      fullAddress: bookingData.fullAddress || '',
      zone: bookingData.zone || '',
      
      // Job details
      hours: bookingData.hours || '',
      professionals: bookingData.professionals || '1',
      materials: bookingData.materials || '',
      
      // Pricing
      totalAmount: bookingData.totalAmount || 0,
      
      // Special requests
      specialRequests: bookingData.specialRequests || '',
      
      // Additional fields that might be useful
      address: bookingData.address || '',
      phone: bookingData.phone || '',
      
      // Metadata
      copiedFrom: id,
      copiedAt: new Date().toISOString(),
    };
    
    // Remove any undefined values to prevent Firestore errors
    Object.keys(copiedJob).forEach(key => {
      if (copiedJob[key] === undefined) {
        delete copiedJob[key];
      }
    });
    
    // Save to copiedJobs collection: copiedJobs/{customerName}/records
    const customerNameForPath = customerName.replace(/[/\\]/g, '-'); // Sanitize customer name
    const copiedJobRef = await db.collection('copiedJobs')
      .doc(customerNameForPath)
      .collection('records')
      .add(copiedJob);
    
    console.log(`✅ Copied booking ${id} as template for customer ${customerName}`);
    console.log(`   Saved to: copiedJobs/${customerNameForPath}/records/${copiedJobRef.id}`);
    
    res.json({
      success: true,
      message: 'Booking copied as template successfully',
      copiedJobId: copiedJobRef.id,
      customerName: customerName
    });
  } catch (err) {
    console.error('Error copying booking:', err);
    res.status(500).json({ error: 'Failed to copy booking' });
  }
});

// GET /bookings/copied-jobs - get all copied jobs grouped by customer
router.get('/copied-jobs/all', async (req, res) => {
  try {
    // Get all customer documents from copiedJobs collection
    const customersSnapshot = await db.collection('copiedJobs').get();
    
    const copiedJobsByCustomer = [];
    
    for (const customerDoc of customersSnapshot.docs) {
      const customerName = customerDoc.id;
      
      // Get all records for this customer
      const recordsSnapshot = await db.collection('copiedJobs')
        .doc(customerName)
        .collection('records')
        .orderBy('copiedAt', 'desc')
        .get();
      
      const records = recordsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      if (records.length > 0) {
        copiedJobsByCustomer.push({
          customerName: customerName,
          jobs: records,
          count: records.length
        });
      }
    }
    
    console.log(`✅ Fetched ${copiedJobsByCustomer.length} customers with copied jobs`);
    
    res.json(copiedJobsByCustomer);
  } catch (err) {
    console.error('Error fetching copied jobs:', err);
    res.status(500).json({ error: 'Failed to fetch copied jobs' });
  }
});

// DELETE /bookings/copied-jobs/:customerId/:jobId - delete a copied job
router.delete('/copied-jobs/:customerId/:jobId', async (req, res) => {
  try {
    const { customerId, jobId } = req.params;
    
    await db.collection('copiedJobs')
      .doc(customerId)
      .collection('records')
      .doc(jobId)
      .delete();
    
    console.log(`✅ Deleted copied job ${jobId} for customer ${customerId}`);
    
    res.json({
      success: true,
      message: 'Copied job deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting copied job:', err);
    res.status(500).json({ error: 'Failed to delete copied job' });
  }
});

module.exports = router; 