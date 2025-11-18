const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');

// GET /settings/toggles - get toggle settings
router.get('/toggles', async (req, res) => {
  try {
    // Get weekly/monthly service setting
    const weeklyMonthlyDoc = await db.collection('settings').doc('weekly-monthly-service').get();
    
    let weeklyMonthlyService = false;
    if (weeklyMonthlyDoc.exists) {
      const data = weeklyMonthlyDoc.data();
      weeklyMonthlyService = data.status || false;
    }
    
    res.json({
      toggles: {
        weeklyMonthlyService: weeklyMonthlyService
      }
    });
    
  } catch (err) {
    console.error('Error fetching toggle settings:', err);
    res.status(500).json({ error: 'Failed to fetch toggle settings' });
  }
});

// POST /settings/toggles - save toggle settings
router.post('/toggles', async (req, res) => {
  try {
    const { toggles } = req.body;
    
    if (!toggles || typeof toggles.weeklyMonthlyService !== 'boolean') {
      return res.status(400).json({ error: 'Invalid toggle data provided' });
    }
    
    // Save weekly/monthly service setting
    await db.collection('settings').doc('weekly-monthly-service').set({
      status: toggles.weeklyMonthlyService,
      updatedAt: new Date()
    });
    
    console.log(`Weekly/Monthly service setting saved: ${toggles.weeklyMonthlyService}`);
    
    res.json({
      success: true,
      message: 'Toggle settings saved successfully',
      toggles: {
        weeklyMonthlyService: toggles.weeklyMonthlyService
      }
    });
    
  } catch (err) {
    console.error('Error saving toggle settings:', err);
    res.status(500).json({ error: 'Failed to save toggle settings' });
  }
});

// GET /settings/booking-availability - get booking availability setting
router.get('/booking-availability', async (req, res) => {
  try {
    const bookingAvailabilityDoc = await db.collection('settings').doc('booking-availability').get();
    
    let bookingAvailability = false;
    let bookingForToday = false;
    if (bookingAvailabilityDoc.exists) {
      const data = bookingAvailabilityDoc.data();
      bookingAvailability = data.bookingavailability || false;
      bookingForToday = data.bookingForToday || false;
    }
    
    res.json({
      bookingavailability: bookingAvailability,
      bookingForToday: bookingForToday
    });
    
  } catch (err) {
    console.error('Error fetching booking availability setting:', err);
    res.status(500).json({ error: 'Failed to fetch booking availability setting' });
  }
});

// POST /settings/booking-availability - save booking availability setting
router.post('/booking-availability', async (req, res) => {
  try {
    const { bookingavailability, bookingForToday } = req.body;
    
    if (typeof bookingavailability !== 'boolean') {
      return res.status(400).json({ error: 'Invalid booking availability data provided' });
    }
    
    if (typeof bookingForToday !== 'boolean') {
      return res.status(400).json({ error: 'Invalid booking for today data provided' });
    }
    
    // Save booking availability settings
    await db.collection('settings').doc('booking-availability').set({
      bookingavailability: bookingavailability,
      bookingForToday: bookingForToday,
      updatedAt: new Date()
    });
    
    console.log(`Booking availability settings saved: availability=${bookingavailability}, today=${bookingForToday}`);
    
    res.json({
      success: true,
      message: 'Booking availability settings saved successfully',
      bookingavailability: bookingavailability,
      bookingForToday: bookingForToday
    });
    
  } catch (err) {
    console.error('Error saving booking availability setting:', err);
    res.status(500).json({ error: 'Failed to save booking availability setting' });
  }
});

module.exports = router; 