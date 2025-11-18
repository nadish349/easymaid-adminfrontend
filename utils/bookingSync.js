/**
 * Booking Synchronization Utilities
 * 
 * This module provides utilities for maintaining data consistency between
 * the main bookings collection and user subcollections.
 */

const { db } = require('../firebaseAdmin');

/**
 * Creates a mirrored booking in the user's subcollection
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @param {Object} bookingData - The complete booking data
 * @returns {Promise<boolean>} - Success status
 */
async function createMirroredBooking(bookingId, userId, bookingData) {
  try {
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    // Ensure createdAt is set
    const dataToStore = {
      ...bookingData,
      createdAt: bookingData.createdAt || new Date().toISOString(),
      mirroredAt: new Date().toISOString()
    };
    
    await userBookingRef.set(dataToStore);
    console.log(`✅ Created mirrored booking ${bookingId} in user ${userId} subcollection`);
    return true;
  } catch (error) {
    console.error(`❌ Error creating mirrored booking ${bookingId} for user ${userId}:`, error);
    return false;
  }
}

/**
 * Updates the assignedStatus in the user's subcollection
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @param {string} assignedStatus - The new assigned status
 * @returns {Promise<boolean>} - Success status
 */
async function syncAssignedStatus(bookingId, userId, assignedStatus) {
  try {
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    // Check if the mirrored booking exists
    const userBookingDoc = await userBookingRef.get();
    if (!userBookingDoc.exists) {
      console.warn(`⚠️ Mirrored booking ${bookingId} not found in user ${userId} subcollection`);
      return false;
    }
    
    await userBookingRef.update({
      assignedStatus: assignedStatus,
      updatedAt: new Date().toISOString()
    });
    
    console.log(`✅ Synced assignedStatus '${assignedStatus}' for booking ${bookingId} in user ${userId} subcollection`);
    return true;
  } catch (error) {
    console.error(`❌ Error syncing assignedStatus for booking ${bookingId} in user ${userId}:`, error);
    return false;
  }
}

/**
 * Syncs all booking fields to the user's subcollection
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @param {Object} updateData - The data to sync
 * @returns {Promise<boolean>} - Success status
 */
async function syncBookingUpdate(bookingId, userId, updateData) {
  try {
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    // Check if the mirrored booking exists
    const userBookingDoc = await userBookingRef.get();
    if (!userBookingDoc.exists) {
      console.warn(`⚠️ Mirrored booking ${bookingId} not found in user ${userId} subcollection`);
      return false;
    }
    
    const syncData = {
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    
    await userBookingRef.update(syncData);
    console.log(`✅ Synced booking update for ${bookingId} in user ${userId} subcollection`);
    return true;
  } catch (error) {
    console.error(`❌ Error syncing booking update for ${bookingId} in user ${userId}:`, error);
    return false;
  }
}

/**
 * Deletes a mirrored booking from the user's subcollection
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @returns {Promise<boolean>} - Success status
 */
async function deleteMirroredBooking(bookingId, userId) {
  try {
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    await userBookingRef.delete();
    console.log(`✅ Deleted mirrored booking ${bookingId} from user ${userId} subcollection`);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting mirrored booking ${bookingId} from user ${userId}:`, error);
    return false;
  }
}

/**
 * Repairs a missing mirrored booking by copying from main collection
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @returns {Promise<boolean>} - Success status
 */
async function repairMirroredBooking(bookingId, userId) {
  try {
    // Get the booking from main collection
    const mainBookingRef = db.collection('bookings').doc(bookingId);
    const mainBookingDoc = await mainBookingRef.get();
    
    if (!mainBookingDoc.exists) {
      console.error(`❌ Main booking ${bookingId} not found`);
      return false;
    }
    
    const bookingData = mainBookingDoc.data();
    
    // Create the mirrored booking
    return await createMirroredBooking(bookingId, userId, bookingData);
  } catch (error) {
    console.error(`❌ Error repairing mirrored booking ${bookingId} for user ${userId}:`, error);
    return false;
  }
}

/**
 * Validates that a mirrored booking exists and is in sync
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Validation result with status and details
 */
async function validateBookingSync(bookingId, userId) {
  try {
    const mainBookingRef = db.collection('bookings').doc(bookingId);
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    const [mainDoc, userDoc] = await Promise.all([
      mainBookingRef.get(),
      userBookingRef.get()
    ]);
    
    if (!mainDoc.exists) {
      return {
        isValid: false,
        status: 'main_not_found',
        message: 'Main booking not found'
      };
    }
    
    if (!userDoc.exists) {
      return {
        isValid: false,
        status: 'mirror_missing',
        message: 'Mirrored booking not found'
      };
    }
    
    const mainData = mainDoc.data();
    const userData = userDoc.data();
    
    // Check if assignedStatus is in sync
    if (mainData.assignedStatus !== userData.assignedStatus) {
      return {
        isValid: false,
        status: 'status_mismatch',
        message: `assignedStatus mismatch: main='${mainData.assignedStatus}', user='${userData.assignedStatus}'`
      };
    }
    
    return {
      isValid: true,
      status: 'in_sync',
      message: 'Bookings are in sync'
    };
  } catch (error) {
    console.error(`❌ Error validating booking sync for ${bookingId}:`, error);
    return {
      isValid: false,
      status: 'validation_error',
      message: error.message
    };
  }
}

module.exports = {
  createMirroredBooking,
  syncAssignedStatus,
  syncBookingUpdate,
  deleteMirroredBooking,
  repairMirroredBooking,
  validateBookingSync
};

