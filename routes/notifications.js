const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');

// GET /notifications/:userId
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const snapshot = await db.collection('users').doc(userId).collection('notifications').get();
    const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// POST /notifications/:userId
router.post('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const data = req.body;
    const docRef = await db.collection('users').doc(userId).collection('notifications').add(data);
    res.status(201).json({ id: docRef.id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add notification' });
  }
});

// DELETE /notifications/:userId/:id
router.delete('/:userId/:id', async (req, res) => {
  try {
    const { userId, id } = req.params;
    await db.collection('users').doc(userId).collection('notifications').doc(id).delete();
    res.json({ message: 'Notification deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router;