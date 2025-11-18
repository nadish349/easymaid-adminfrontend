const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');

// GET /crews - fetch all crew members
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('crews').get();
    const crews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(crews);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch crews' });
  }
});

// POST /crews - add a new crew member
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    const docRef = await db.collection('crews').add(data);
    res.status(201).json({ id: docRef.id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add crew member' });
  }
});

// PUT /crews/:id - update a crew member
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    await db.collection('crews').doc(id).update(data);
    res.json({ id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update crew member' });
  }
});

// PATCH /crews/:id - update specific crew fields (including increment operations)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Validate that the crew exists
    const crewRef = db.collection('crews').doc(id);
    const crewDoc = await crewRef.get();
    
    if (!crewDoc.exists) {
      return res.status(404).json({ error: 'Crew not found' });
    }
    
    // Handle increment/decrement operations
    const finalUpdateData = { ...updateData };
    if (updateData.hours) {
      const currentHours = crewDoc.data().hours || 0;
      if (updateData.hours.$increment) {
        finalUpdateData.hours = currentHours + updateData.hours.$increment;
        delete finalUpdateData.hours.$increment;
      } else if (updateData.hours.$decrement) {
        finalUpdateData.hours = Math.max(0, currentHours - updateData.hours.$decrement);
        delete finalUpdateData.hours.$decrement;
      }
    }
    
    // Update the crew
    await crewRef.update({
      ...finalUpdateData,
      updatedAt: new Date()
    });
    
    // Get the updated crew
    const updatedDoc = await crewRef.get();
    const updatedCrew = { id: updatedDoc.id, ...updatedDoc.data() };
    
    res.json(updatedCrew);
  } catch (err) {
    console.error('Error updating crew:', err);
    res.status(500).json({ error: 'Failed to update crew' });
  }
});

// DELETE /crews/:id - delete a crew member
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('crews').doc(id).delete();
    res.json({ message: 'Crew member deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete crew member' });
  }
});

// POST /crews/:id/settle-payment - settle payment for a crew member
router.post('/:id/settle-payment', async (req, res) => {
  try {
    const { id } = req.params;
    const { crewId, crewName, recordNumber, hours, amount, settledAt } = req.body;
    
    // Validate that the crew exists
    const crewRef = db.collection('crews').doc(id);
    const crewDoc = await crewRef.get();
    
    if (!crewDoc.exists) {
      return res.status(404).json({ error: 'Crew not found' });
    }
    
    const crewData = crewDoc.data();
    
    // Create payment record in paymentDetails collection
    const paymentRecord = {
      crewId,
      crewName: crewName || crewData.name,
      recordNumber: recordNumber || crewData.recordNumber,
      mobile: crewData.mobile || '',
      countryCode: crewData.countryCode || '',
      crewZone: crewData.crewZone || '',
      hours: hours || 0,
      amount: amount || 0,
      settledAt: settledAt || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    
    // Save to nested structure: paymentDetails -> crewName -> records
    const crewNameForPath = (crewName || crewData.name).replace(/[/\\]/g, '-'); // Sanitize crew name for Firestore path
    const paymentRef = await db.collection('paymentDetails')
      .doc(crewNameForPath)
      .collection('records')
      .add(paymentRecord);
    
    // Reset crew hours and totalAmount to 0
    await crewRef.update({
      hours: 0,
      totalAmount: 0,
      lastPaymentSettlement: new Date().toISOString(),
      updatedAt: new Date()
    });
    
    console.log(`✅ Payment settled for crew ${crewNameForPath}: ${hours} hours, AED ${amount}`);
    console.log(`   Payment record saved with ID: ${paymentRef.id}`);
    
    res.json({
      message: 'Payment settled successfully',
      paymentRecordId: paymentRef.id,
      paymentRecord
    });
  } catch (err) {
    console.error('Error settling payment:', err);
    res.status(500).json({ error: 'Failed to settle payment' });
  }
});

// GET /crews/:id/payment-history - get payment history for a crew member
router.get('/:id/payment-history', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get crew details to fetch their name
    const crewRef = db.collection('crews').doc(id);
    const crewDoc = await crewRef.get();
    
    if (!crewDoc.exists) {
      return res.status(404).json({ error: 'Crew not found' });
    }
    
    const crewData = crewDoc.data();
    const crewName = crewData.name;
    const crewNameForPath = crewName.replace(/[/\\]/g, '-'); // Sanitize crew name for Firestore path
    
    // Fetch payment records from nested structure: paymentDetails -> crewName -> records
    const snapshot = await db.collection('paymentDetails')
      .doc(crewNameForPath)
      .collection('records')
      .orderBy('settledAt', 'desc')
      .get();
    
    const paymentHistory = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    console.log(`✅ Fetched ${paymentHistory.length} payment records for crew: ${crewName}`);
    
    res.json(paymentHistory);
  } catch (err) {
    console.error('Error fetching payment history:', err);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

module.exports = router; 