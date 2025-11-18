const express = require('express');
const router = express.Router();
const { db } = require('../firebaseAdmin');
const { sendCouponEmail } = require('../controllers/emailController');

// GET /coupons - fetch all coupons
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('coupons').get();
    const coupons = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(coupons);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

// POST /coupons - add a new coupon
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    const docRef = await db.collection('coupons').add(data);
    res.status(201).json({ id: docRef.id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add coupon' });
  }
});

// PUT /coupons/:id - update a coupon
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    await db.collection('coupons').doc(id).update(data);
    res.json({ id, ...data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update coupon' });
  }
});

// DELETE /coupons/:id - delete a coupon
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('coupons').doc(id).delete();
    res.json({ message: 'Coupon deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete coupon' });
  }
});

// POST /coupons/:id/issue - scan users, issue coupon codes, notify and email
router.post('/:id/issue', async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch coupon definition
    const couponDoc = await db.collection('coupons').doc(id).get();
    if (!couponDoc.exists) {
      return res.status(404).json({ error: 'Coupon not found' });
    }
    const coupon = { id, ...couponDoc.data() };
    const {
      type,
      title,
      description,
      isActive,
      discountType,
      discountValue,
      threshold,
      validFrom,
      validUntil,
      usageLimit = 1
    } = coupon;

    if (!isActive) {
      return res.status(400).json({ error: 'Coupon is inactive' });
    }

    // Fetch users
    const usersSnapshot = await db.collection('users').get();
    const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const eligibleUsers = [];
    for (const user of users) {
      const totalHours = parseFloat(user.hours) || 0;
      const totalAmount = parseFloat(user.totalAmount) || 0;

      let isEligible = false;

      // Type 1: Total hours exceeds threshold
      if (type === 'totalHoursThreshold') {
        isEligible = threshold !== undefined && totalHours >= parseFloat(threshold);
      } 
      // Type 2: Total amount exceeds threshold
      else if (type === 'totalAmountThreshold') {
        isEligible = threshold !== undefined && totalAmount >= parseFloat(threshold);
      } 
      // Type 3: Festival/Special occasion (all customers)
      else if (type === 'festivalAll') {
        isEligible = true;
      } 
      // Type 4: Single booking hours exceeds threshold
      else if (type === 'singleBookingHoursThreshold') {
        if (threshold !== undefined) {
          const bookingsSnapshot = await db.collection('users').doc(user.id).collection('bookings').get();
          const hasLargeBooking = bookingsSnapshot.docs.some(d => {
            const data = d.data();
            const h = parseFloat(data.hours) || 0;
            return h >= parseFloat(threshold);
          });
          isEligible = hasLargeBooking;
        }
      }

      if (!isEligible) continue;

      // Ensure idempotency: skip if already issued and not used
      const userCouponsSnapshot = await db
        .collection('users').doc(user.id)
        .collection('coupons')
        .where('couponId', '==', id)
        .where('status', '==', 'issued')
        .get();

      if (!userCouponsSnapshot.empty) {
        continue;
      }

      // Generate a coupon code
      const codeBase = title?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'COUPON';
      const code = `${codeBase}-${id.slice(-4)}-${(user.id || '').slice(-4)}`.toUpperCase();

      // Save coupon to user's subcollection
      const userCoupon = {
        couponId: id,
        code,
        status: 'issued',
        discountType,
        discountValue,
        title,
        description,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        issuedAt: new Date().toISOString(),
        usedAt: null
      };
      await db.collection('users').doc(user.id).collection('coupons').add(userCoupon);

      // Add notification to user
      await db.collection('users').doc(user.id).collection('notifications').add({
        type: 'coupon',
        title: `🎁 Coupon: ${title || 'Reward'}`,
        message: description || 'You received a coupon!',
        code,
        discountType,
        discountValue,
        createdAt: new Date().toISOString(),
        read: false
      });

      // Send email if possible
      const userEmail = user.email || '';
      if (userEmail) {
        await sendCouponEmail({
          to: userEmail,
          customerName: user.name || user.customerName || 'Customer',
          code,
          title,
          description,
          discountType,
          discountValue,
          validFrom,
          validUntil
        });
      }

      eligibleUsers.push({ userId: user.id, code });
    }

    res.json({
      success: true,
      couponId: id,
      issuedCount: eligibleUsers.length,
      issuedTo: eligibleUsers
    });
  } catch (err) {
    console.error('Error issuing coupons:', err);
    res.status(500).json({ error: 'Failed to issue coupons' });
  }
});

// POST /coupons/redeem - mark a user's coupon as used
router.post('/redeem', async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ error: 'userId and code are required' });
    }

    const couponsRef = db.collection('users').doc(userId).collection('coupons');
    const matchSnapshot = await couponsRef
      .where('code', '==', code)
      .limit(1)
      .get();

    if (matchSnapshot.empty) {
      return res.status(404).json({ error: 'Coupon not found for user' });
    }

    const docRef = matchSnapshot.docs[0].ref;
    const data = matchSnapshot.docs[0].data();

    if (data.status === 'used') {
      return res.status(400).json({ error: 'Coupon already used' });
    }

    await docRef.update({
      status: 'used',
      usedAt: new Date().toISOString()
    });

    // Increment usedCount on master coupon
    if (data.couponId) {
      const couponDocRef = db.collection('coupons').doc(data.couponId);
      const couponDoc = await couponDocRef.get();
      if (couponDoc.exists) {
        const couponData = couponDoc.data();
        const usedCount = parseInt(couponData.usedCount || 0, 10) + 1;
        await couponDocRef.update({ usedCount });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error redeeming coupon:', err);
    res.status(500).json({ error: 'Failed to redeem coupon' });
  }
});

module.exports = router; 