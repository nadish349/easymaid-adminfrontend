const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');

// GET /request_subscriptions?status=requested
router.get('/', async (req, res) => {
  try {
    let ref = db.collection('request_subscriptions');
    if (req.query.status) {
      ref = ref.where('status', '==', req.query.status);
    }
    const snapshot = await ref.get();
    const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// POST /request_subscriptions
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    const docRef = await db.collection('request_subscriptions').add(data);
    res.status(201).json({ id: docRef.id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add request' });
  }
});

// PUT /request_subscriptions/:id
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    await db.collection('request_subscriptions').doc(id).update(data);

    // If status is accepted, update user's paymentstatus
    if (data.status === 'accepted' && data.userId) {
      await db.collection('users').doc(data.userId).update({ paymentstatus: 'accepted' });
    }

    res.json({ id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// DELETE /request_subscriptions/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('request_subscriptions').doc(id).delete();
    res.json({ message: 'Request deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

module.exports = router;