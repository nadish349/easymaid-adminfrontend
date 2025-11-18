const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');

// GET /drivers - fetch all drivers
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('drivers').get();
    const drivers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch drivers' });
  }
});

// POST /drivers - add a new driver
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    const docRef = await db.collection('drivers').add(data);
    res.status(201).json({ id: docRef.id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add driver' });
  }
});

// PUT /drivers/:id - update a driver
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    await db.collection('drivers').doc(id).update(data);
    res.json({ id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update driver' });
  }
});

module.exports = router; 