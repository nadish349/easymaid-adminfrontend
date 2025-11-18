const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');
const { generateToken } = require('../utils/jwt');
const { authenticateToken } = require('../middleware/auth');

const ADMIN_COLLECTION = "adminonly";
const ADMIN_DOC_ID = "main";

// GET /admin/credentials - get admin credentials (protected)
router.get('/credentials', authenticateToken, async (req, res) => {
  try {
    const docRef = db.collection(ADMIN_COLLECTION).doc(ADMIN_DOC_ID);
    const snapshot = await docRef.get();
    
    if (snapshot.exists) {
      const data = snapshot.data();
      res.json({
        email: data.email,
        password: data.password
      });
    } else {
      res.status(404).json({ error: 'Admin credentials not found' });
    }
  } catch (err) {
    console.error('Error fetching admin credentials:', err);
    res.status(500).json({ error: 'Failed to fetch admin credentials' });
  }
});

// POST /admin/login - verify admin login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const docRef = db.collection(ADMIN_COLLECTION).doc(ADMIN_DOC_ID);
    const snapshot = await docRef.get();
    
    if (snapshot.exists) {
      const data = snapshot.data();
      if (email === data.email && password === data.password) {
        // Generate JWT token
        const token = generateToken({ 
          email: data.email,
          adminId: ADMIN_DOC_ID,
          type: 'admin'
        });
        
        res.json({ 
          success: true, 
          message: 'Login successful',
          token: token
        });
      } else {
        res.status(401).json({ error: 'Invalid credentials' });
      }
    } else {
      res.status(404).json({ error: 'Admin credentials not found' });
    }
  } catch (err) {
    console.error('Error during admin login:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /admin/credentials - set admin credentials (protected)
router.post('/credentials', authenticateToken, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const docRef = db.collection(ADMIN_COLLECTION).doc(ADMIN_DOC_ID);
    await docRef.set({ email, password });
    
    res.json({ success: true, message: 'Admin credentials updated' });
  } catch (err) {
    console.error('Error setting admin credentials:', err);
    res.status(500).json({ error: 'Failed to update admin credentials' });
  }
});

// POST /admin/run-auto-archive - manually trigger auto-archive process
router.post('/run-auto-archive', async (req, res) => {
  try {
    const { autoArchiveDays } = req.body;
    
    // Get archive configuration
    const settingsRef = db.collection('settings').doc('archive');
    const settingsDoc = await settingsRef.get();
    
    if (!settingsDoc.exists) {
      return res.status(400).json({ error: 'Archive configuration not found' });
    }
    
    const settings = settingsDoc.data();
    
    if (!settings.autoArchive) {
      return res.status(400).json({ error: 'Auto-archive is not enabled' });
    }
    
    // Use provided autoArchiveDays or fall back to settings
    const daysToArchive = autoArchiveDays || settings.autoArchiveDays || 30;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToArchive);
    
    console.log(`Running auto-archive for bookings older than ${daysToArchive} days: ${cutoffDate.toISOString()}`);
    
    // Query bookings where the service date is older than the cutoff date
    const snapshot = await db.collection('bookings')
      .where('date', '<', cutoffDate.toISOString().split('T')[0])
      .get();
    
    if (snapshot.empty) {
      return res.json({ 
        success: true, 
        message: 'No bookings found to archive',
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
        archiveReason: 'auto_archive'
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
    
    // Update last auto-archive timestamp
    await settingsRef.update({
      lastAutoArchive: new Date()
    });
    
    console.log(`Auto-archive completed: ${archivedBookings.length} bookings archived`);
    
    res.json({
      success: true,
      message: `Auto-archive completed: ${archivedBookings.length} bookings archived`,
      archivedCount: archivedBookings.length,
      archivedBookings: archivedBookings
    });
    
  } catch (err) {
    console.error('Error running auto-archive:', err);
    res.status(500).json({ error: 'Failed to run auto-archive' });
  }
});

// GET /admin/archive-stats - get archive statistics
router.get('/archive-stats', async (req, res) => {
  try {
    // Get current bookings count
    const bookingsSnapshot = await db.collection('bookings').get();
    const currentBookingsCount = bookingsSnapshot.size;
    
    // Get archived bookings count
    const archivedSnapshot = await db.collection('archivedBookings').get();
    const archivedBookingsCount = archivedSnapshot.size;
    
    // Get archive configuration
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
    
    // Calculate pending archive count
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - archiveSettings.autoArchiveDays);
    
    const pendingSnapshot = await db.collection('bookings')
      .where('date', '<', cutoffDate.toISOString().split('T')[0])
      .get();
    
    res.json({
      currentBookingsCount,
      archivedBookingsCount,
      pendingArchiveCount: pendingSnapshot.size,
      archiveSettings
    });
    
  } catch (err) {
    console.error('Error getting archive stats:', err);
    res.status(500).json({ error: 'Failed to get archive stats' });
  }
});

module.exports = router; 