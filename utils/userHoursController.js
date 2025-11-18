const { db } = require('../firebaseAdmin');

/**
 * User Hours Controller
 * Manages the increment and decrement of hours field in users collection
 * based on booking payment status changes
 */

/**
 * Increment user hours when a booking is paid
 * @param {string} userId - User document ID
 * @param {number} hours - Number of hours to increment
 * @param {string} bookingId - Booking ID (for logging)
 * @returns {Promise<boolean>} - Success status
 */
async function incrementUserHours(userId, hours, bookingId) {
  try {
    if (!userId || !hours || hours <= 0) {
      console.log(`⏭️ Skipping hours increment: userId=${userId}, hours=${hours}`);
      return false;
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.warn(`⚠️ User ${userId} not found, cannot increment hours`);
      return false;
    }

    const userData = userDoc.data();
    const currentHours = parseFloat(userData.hours) || 0;
    const hoursToAdd = parseFloat(hours);
    const newHours = currentHours + hoursToAdd;

    await userRef.update({
      hours: newHours,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ HOURS INCREMENT: User ${userId}, Booking ${bookingId}`);
    console.log(`   ${currentHours} hours → ${newHours} hours (+${hoursToAdd})`);

    return true;
  } catch (error) {
    console.error(`❌ Error incrementing hours for user ${userId}:`, error);
    return false;
  }
}

/**
 * Decrement user hours when a payment is reversed
 * @param {string} userId - User document ID
 * @param {number} hours - Number of hours to decrement
 * @param {string} bookingId - Booking ID (for logging)
 * @returns {Promise<boolean>} - Success status
 */
async function decrementUserHours(userId, hours, bookingId) {
  try {
    if (!userId || !hours || hours <= 0) {
      console.log(`⏭️ Skipping hours decrement: userId=${userId}, hours=${hours}`);
      return false;
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.warn(`⚠️ User ${userId} not found, cannot decrement hours`);
      return false;
    }

    const userData = userDoc.data();
    const currentHours = parseFloat(userData.hours) || 0;
    const hoursToSubtract = parseFloat(hours);
    const newHours = Math.max(0, currentHours - hoursToSubtract); // Prevent negative hours

    await userRef.update({
      hours: newHours,
      updatedAt: new Date().toISOString()
    });

    console.log(`✅ HOURS DECREMENT: User ${userId}, Booking ${bookingId}`);
    console.log(`   ${currentHours} hours → ${newHours} hours (-${hoursToSubtract})`);

    return true;
  } catch (error) {
    console.error(`❌ Error decrementing hours for user ${userId}:`, error);
    return false;
  }
}

/**
 * Handle hours update when booking is created
 * Only increments if payment status is 'paid' AND source is 'admin'
 * This prevents double-counting when users make bookings from the user frontend
 * @param {string} userId - User document ID
 * @param {number} hours - Number of hours booked
 * @param {string} paymentStatus - Payment status (paid/partial/due)
 * @param {string} source - Booking source ('admin' or 'user')
 * @param {string} bookingId - Booking ID
 * @returns {Promise<boolean>} - Success status
 */
async function handleBookingCreationHours(userId, hours, paymentStatus, source, bookingId) {
  try {
    console.log(`🔍 BOOKING CREATION HOURS CHECK: Booking ${bookingId}`);
    console.log(`   PaymentStatus: ${paymentStatus}, Source: ${source}`);
    
    // Only increment hours if:
    // 1. Payment status is 'paid'
    // 2. Source is 'admin' (admin-created bookings)
    // User frontend bookings are handled differently (hours added via rewards/subscription)
    if (paymentStatus === 'paid' && source === 'admin') {
      console.log(`💰 Admin-created paid booking, incrementing ${hours} hours for user ${userId}`);
      return await incrementUserHours(userId, hours, bookingId);
    } else if (paymentStatus === 'paid' && source !== 'admin') {
      console.log(`ℹ️ User-created paid booking, hours NOT incremented (handled by user frontend)`);
      return true;
    } else {
      console.log(`⏳ Payment is '${paymentStatus}', hours will be incremented when payment is completed`);
      return true; // Not an error, just deferred
    }
  } catch (error) {
    console.error(`❌ Error handling booking creation hours:`, error);
    return false;
  }
}

/**
 * Handle hours update when payment status changes
 * @param {string} userId - User document ID
 * @param {number} hours - Number of hours booked
 * @param {string} oldPaymentStatus - Previous payment status
 * @param {string} newPaymentStatus - New payment status
 * @param {string} bookingId - Booking ID
 * @returns {Promise<boolean>} - Success status
 */
async function handlePaymentStatusChangeHours(userId, hours, oldPaymentStatus, newPaymentStatus, bookingId) {
  try {
    console.log(`🔍 PAYMENT STATUS CHANGE HOURS CHECK: Booking ${bookingId}`);
    console.log(`   ${oldPaymentStatus} → ${newPaymentStatus}`);
    
    // Case 1: Payment completed (due/partial → paid)
    if (oldPaymentStatus !== 'paid' && newPaymentStatus === 'paid') {
      console.log(`✅ Payment completed, incrementing ${hours} hours for user ${userId}`);
      return await incrementUserHours(userId, hours, bookingId);
    }
    
    // Case 2: Payment reversed (paid → due/partial)
    if (oldPaymentStatus === 'paid' && newPaymentStatus !== 'paid') {
      console.log(`⚠️ Payment reversed, decrementing ${hours} hours for user ${userId}`);
      return await decrementUserHours(userId, hours, bookingId);
    }
    
    // Case 3: No hours change needed (partial ↔ due, or same status)
    console.log(`ℹ️ No hours change needed for this payment status transition`);
    return true;
  } catch (error) {
    console.error(`❌ Error handling payment status change hours:`, error);
    return false;
  }
}

/**
 * Handle hours update when booking is deleted
 * Only decrements if payment status was 'paid'
 * @param {string} userId - User document ID
 * @param {number} hours - Number of hours booked
 * @param {string} paymentStatus - Payment status
 * @param {string} bookingId - Booking ID
 * @returns {Promise<boolean>} - Success status
 */
async function handleBookingDeletionHours(userId, hours, paymentStatus, bookingId) {
  try {
    console.log(`🔍 BOOKING DELETION HOURS CHECK: Booking ${bookingId}, PaymentStatus: ${paymentStatus}`);
    
    if (paymentStatus === 'paid') {
      console.log(`💰 Booking was paid, decrementing ${hours} hours for user ${userId}`);
      return await decrementUserHours(userId, hours, bookingId);
    } else {
      console.log(`ℹ️ Booking was not paid, no hours decrement needed`);
      return true;
    }
  } catch (error) {
    console.error(`❌ Error handling booking deletion hours:`, error);
    return false;
  }
}

module.exports = {
  incrementUserHours,
  decrementUserHours,
  handleBookingCreationHours,
  handlePaymentStatusChangeHours,
  handleBookingDeletionHours
};
