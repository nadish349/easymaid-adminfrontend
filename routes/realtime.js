const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');

// GET /realtime/stats - get real-time service statistics
router.get('/stats', async (req, res) => {
  try {
    // This would typically come from a monitoring service
    // For now, we'll return basic stats
    const stats = {
      activeConnections: 0, // Would be tracked in a real implementation
      cacheHitRate: 0,
      lastUpdate: new Date().toISOString()
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get real-time stats' });
  }
});

// POST /realtime/batch - perform batch operations
router.post('/batch', async (req, res) => {
  try {
    const { operations } = req.body;
    
    if (!Array.isArray(operations)) {
      return res.status(400).json({ error: 'Operations must be an array' });
    }

    const batch = db.batch();
    const results = [];

    for (const operation of operations) {
      const { type, collection, id, data } = operation;
      
      if (type === 'add') {
        const docRef = db.collection(collection).doc();
        batch.set(docRef, {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        results.push({ id: docRef.id, type: 'add' });
      } else if (type === 'update' && id) {
        const docRef = db.collection(collection).doc(id);
        batch.update(docRef, {
          ...data,
          updatedAt: new Date()
        });
        results.push({ id, type: 'update' });
      } else if (type === 'delete' && id) {
        const docRef = db.collection(collection).doc(id);
        batch.delete(docRef);
        results.push({ id, type: 'delete' });
      }
    }

    await batch.commit();
    res.json({ success: true, results });
  } catch (err) {
    console.error('Batch operation error:', err);
    res.status(500).json({ error: 'Failed to perform batch operation' });
  }
});

// POST /realtime/invalidate - invalidate cache for specific collection
router.post('/invalidate', async (req, res) => {
  try {
    const { collection, documentId } = req.body;
    
    // In a real implementation, this would invalidate the cache
    // For now, we'll just log the invalidation
    console.log(`Cache invalidation requested for ${collection}${documentId ? `/${documentId}` : ''}`);
    
    res.json({ success: true, message: 'Cache invalidated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to invalidate cache' });
  }
});

// GET /realtime/collections/:collection - get collection with real-time support
router.get('/collections/:collection', async (req, res) => {
  try {
    const { collection } = req.params;
    const { query, orderBy, limit } = req.query;
    
    let ref = db.collection(collection);
    
    // Apply query filters
    if (query) {
      try {
        const queryObj = JSON.parse(query);
        queryObj.forEach(({ field, operator, value }) => {
          ref = ref.where(field, operator, value);
        });
      } catch (err) {
        console.error('Invalid query format:', err);
      }
    }
    
    // Apply ordering
    if (orderBy) {
      try {
        const orderByObj = JSON.parse(orderBy);
        orderByObj.forEach(({ field, direction }) => {
          ref = ref.orderBy(field, direction);
        });
      } catch (err) {
        console.error('Invalid orderBy format:', err);
      }
    }
    
    // Apply limit
    if (limit) {
      ref = ref.limit(parseInt(limit));
    }
    
    const snapshot = await ref.get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    res.json(data);
  } catch (err) {
    console.error('Collection fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch collection' });
  }
});

// GET /realtime/documents/:collection/:id - get single document with real-time support
router.get('/documents/:collection/:id', async (req, res) => {
  try {
    const { collection, id } = req.params;
    
    const doc = await db.collection(collection).doc(id).get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    const data = { id: doc.id, ...doc.data() };
    res.json(data);
  } catch (err) {
    console.error('Document fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

module.exports = router; 