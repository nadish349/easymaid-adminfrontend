const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');

// GET /users - fetch all users
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('users').get();
    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /users - register/store a user
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    const docRef = await db.collection('users').add(data);
    res.status(201).json({ id: docRef.id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// GET /users/:id - fetch user by id
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'User not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PUT /users/:id - update user
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    await db.collection('users').doc(id).update(data);
    res.json({ id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// PATCH /users/:id/totalAmount - increment user's totalAmount
router.patch('/:id/totalAmount', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    
    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    
    const userRef = db.collection('users').doc(id);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const currentTotalAmount = userData.totalAmount || 0;
    const newTotalAmount = currentTotalAmount + parseFloat(amount);
    
    await userRef.update({
      totalAmount: newTotalAmount
    });
    
    res.json({ 
      id, 
      previousTotalAmount: currentTotalAmount,
      newTotalAmount: newTotalAmount,
      incrementAmount: parseFloat(amount)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user totalAmount' });
  }
});

// PUT /users/:id/update-total-amount - update user's totalAmount by difference
router.put('/:id/update-total-amount', async (req, res) => {
  try {
    const { id } = req.params;
    const { amountDifference } = req.body;
    
    if (amountDifference === undefined || isNaN(parseFloat(amountDifference))) {
      return res.status(400).json({ error: 'Valid amountDifference is required' });
    }
    
    const userRef = db.collection('users').doc(id);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const currentTotalAmount = userData.totalAmount || 0;
    const newTotalAmount = Math.max(0, currentTotalAmount + parseFloat(amountDifference));
    
    await userRef.update({
      totalAmount: newTotalAmount
    });
    
    res.json({ 
      id, 
      previousTotalAmount: currentTotalAmount,
      newTotalAmount: newTotalAmount,
      amountDifference: parseFloat(amountDifference)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user totalAmount' });
  }
});

// GET /users/:id/bookings - fetch user's bookings from subcollection
router.get('/:id/bookings', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user exists
    const userDoc = await db.collection('users').doc(id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Fetch bookings from subcollection
    const bookingsSnapshot = await db.collection('users').doc(id).collection('bookings').get();
    const bookings = bookingsSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));
    
    res.json(bookings);
  } catch (err) {
    console.error('Error fetching user bookings:', err);
    res.status(500).json({ error: 'Failed to fetch user bookings' });
  }
});

module.exports = router; 