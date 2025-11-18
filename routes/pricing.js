const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');

// GET pricing settings
router.get('/', async (req, res) => {
  try {
    const pricingRef = db.collection('pricing');
    const snapshot = await pricingRef.get();
    
    if (snapshot.empty) {
      // Return default values if no pricing settings exist
      return res.json({
        hourlyRate: 25,
        materialRate: 15
      });
    }
    
    const pricingData = {};
    snapshot.forEach(doc => {
      pricingData[doc.id] = doc.data();
    });
    
    res.json(pricingData);
  } catch (error) {
    console.error('Error fetching pricing settings:', error);
    res.status(500).json({ error: 'Failed to fetch pricing settings' });
  }
});

// POST new pricing settings
router.post('/', async (req, res) => {
  try {
    const { hourlyRate, materialRate } = req.body;
    
    if (hourlyRate === undefined || materialRate === undefined) {
      return res.status(400).json({ error: 'Both hourlyRate and materialRate are required' });
    }
    
    // Clear existing pricing settings
    const pricingRef = db.collection('pricing');
    const snapshot = await pricingRef.get();
    const batch = db.batch();
    
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Add new pricing settings
    const hourlyDocRef = pricingRef.doc('hourly');
    const materialDocRef = pricingRef.doc('material');
    
    batch.set(hourlyDocRef, {
      rate: parseFloat(hourlyRate),
      updatedAt: new Date().toISOString()
    });
    
    batch.set(materialDocRef, {
      rate: parseFloat(materialRate),
      updatedAt: new Date().toISOString()
    });
    
    await batch.commit();
    
    res.status(201).json({
      message: 'Pricing settings updated successfully',
      hourlyRate: parseFloat(hourlyRate),
      materialRate: parseFloat(materialRate)
    });
  } catch (error) {
    console.error('Error updating pricing settings:', error);
    res.status(500).json({ error: 'Failed to update pricing settings' });
  }
});

// PUT to update specific pricing setting
router.put('/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { rate } = req.body;
    
    if (!rate || isNaN(rate)) {
      return res.status(400).json({ error: 'Valid rate is required' });
    }
    
    if (type !== 'hourly' && type !== 'material') {
      return res.status(400).json({ error: 'Type must be either "hourly" or "material"' });
    }
    
    const docRef = db.collection('pricing').doc(type);
    await docRef.set({
      rate: parseFloat(rate),
      updatedAt: new Date().toISOString()
    });
    
    res.json({
      message: `${type} rate updated successfully`,
      rate: parseFloat(rate)
    });
  } catch (error) {
    console.error(`Error updating ${req.params.type} rate:`, error);
    res.status(500).json({ error: `Failed to update ${req.params.type} rate` });
  }
});

module.exports = router; 