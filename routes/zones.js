const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');

// GET /zones - fetch all zones
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('zones').get();
    const zones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(zones);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch zones' });
  }
});

// POST /zones - add a new zone
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    const docRef = await db.collection('zones').add(data);
    res.status(201).json({ id: docRef.id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add zone' });
  }
});

// PUT /zones/:id - update a zone
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    await db.collection('zones').doc(id).update(data);
    res.json({ id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update zone' });
  }
});

// DELETE /zones/:id - delete a zone
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('zones').doc(id).delete();
    res.json({ message: 'Zone deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete zone' });
  }
});

module.exports = router; 