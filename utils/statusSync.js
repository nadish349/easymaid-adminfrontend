/**
 * AssignedStatus Synchronization Controller
 * 
 * This module handles the synchronization of assignedStatus between
 * the main bookings collection and user subcollections.
 */

const { db } = require('../firebaseAdmin');

/**
 * Sync assignedStatus from main booking to user subcollection
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @param {string} assignedStatus - The new assigned status
 * @returns {Promise<boolean>} - Success status
 */
async function syncAssignedStatus(bookingId, userId, assignedStatus) {
  try {
    console.log(`🔄 Syncing assignedStatus for booking ${bookingId} to user ${userId}: ${assignedStatus}`);
    
    // Get the main booking to verify it exists and get current data
    const mainBookingRef = db.collection('bookings').doc(bookingId);
    const mainBookingDoc = await mainBookingRef.get();
    
    if (!mainBookingDoc.exists) {
      console.error(`❌ Main booking ${bookingId} not found`);
      return false;
    }
    
    const mainBookingData = mainBookingDoc.data();
    console.log(`📋 Main booking data:`, {
      id: bookingId,
      userId: mainBookingData.userId,
      currentStatus: mainBookingData.assignedStatus,
      newStatus: assignedStatus
    });
    
    // Update the user's mirrored booking
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    // Check if the mirrored booking exists
    const userBookingDoc = await userBookingRef.get();
    if (!userBookingDoc.exists) {
      console.warn(`⚠️ Mirrored booking ${bookingId} not found in user ${userId} subcollection`);
      
      // Try to create the missing mirrored booking
      console.log(`🔧 Attempting to create missing mirrored booking...`);
      const createSuccess = await createMissingMirroredBooking(bookingId, userId, mainBookingData);
      if (!createSuccess) {
        console.error(`❌ Failed to create missing mirrored booking`);
        return false;
      }
    }
    
    // Update the assignedStatus in user subcollection
    await userBookingRef.update({
      assignedStatus: assignedStatus,
      updatedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    });
    
    console.log(`✅ Successfully synced assignedStatus '${assignedStatus}' for booking ${bookingId} in user ${userId} subcollection`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error syncing assignedStatus for booking ${bookingId} in user ${userId}:`, error);
    return false;
  }
}

/**
 * Create a missing mirrored booking from main collection data
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @param {Object} mainBookingData - The main booking data
 * @returns {Promise<boolean>} - Success status
 */
async function createMissingMirroredBooking(bookingId, userId, mainBookingData) {
  try {
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    const mirroredData = {
      ...mainBookingData,
      mirroredAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    };
    
    await userBookingRef.set(mirroredData);
    console.log(`✅ Created missing mirrored booking ${bookingId} for user ${userId}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error creating missing mirrored booking ${bookingId} for user ${userId}:`, error);
    return false;
  }
}

/**
 * Sync all booking fields from main collection to user subcollection
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @param {Object} updateData - The data to sync
 * @returns {Promise<boolean>} - Success status
 */
async function syncBookingUpdate(bookingId, userId, updateData) {
  try {
    console.log(`🔄 Syncing booking update for ${bookingId} to user ${userId}:`, updateData);
    
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    // Check if the mirrored booking exists
    const userBookingDoc = await userBookingRef.get();
    if (!userBookingDoc.exists) {
      console.warn(`⚠️ Mirrored booking ${bookingId} not found in user ${userId} subcollection`);
      return false;
    }
    
    const syncData = {
      ...updateData,
      updatedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    };
    
    await userBookingRef.update(syncData);
    console.log(`✅ Successfully synced booking update for ${bookingId} in user ${userId} subcollection`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error syncing booking update for ${bookingId} in user ${userId}:`, error);
    return false;
  }
}

/**
 * Validate that assignedStatus is in sync between main and user collections
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Validation result
 */
async function validateStatusSync(bookingId, userId) {
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
    
    if (mainData.assignedStatus !== userData.assignedStatus) {
      return {
        isValid: false,
        status: 'status_mismatch',
        message: `assignedStatus mismatch: main='${mainData.assignedStatus}', user='${userData.assignedStatus}'`,
        mainStatus: mainData.assignedStatus,
        userStatus: userData.assignedStatus
      };
    }
    
    return {
      isValid: true,
      status: 'in_sync',
      message: 'assignedStatus is in sync',
      status: mainData.assignedStatus
    };
    
  } catch (error) {
    console.error(`❌ Error validating status sync for ${bookingId}:`, error);
    return {
      isValid: false,
      status: 'validation_error',
      message: error.message
    };
  }
}

/**
 * Force sync all booking data from main to user collection
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @returns {Promise<boolean>} - Success status
 */
async function forceSyncBooking(bookingId, userId) {
  try {
    console.log(`🔄 Force syncing booking ${bookingId} for user ${userId}`);
    
    // Get main booking data
    const mainBookingRef = db.collection('bookings').doc(bookingId);
    const mainBookingDoc = await mainBookingRef.get();
    
    if (!mainBookingDoc.exists) {
      console.error(`❌ Main booking ${bookingId} not found`);
      return false;
    }
    
    const mainData = mainBookingDoc.data();
    
    // Update user subcollection with all main data
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    const syncData = {
      ...mainData,
      lastSyncAt: new Date().toISOString(),
      forceSyncedAt: new Date().toISOString()
    };
    
    await userBookingRef.set(syncData);
    console.log(`✅ Force synced booking ${bookingId} for user ${userId}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error force syncing booking ${bookingId} for user ${userId}:`, error);
    return false;
  }
}

/**
 * Get sync status for a booking
 * @param {string} bookingId - The booking document ID
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - Sync status information
 */
async function getSyncStatus(bookingId, userId) {
  try {
    const mainBookingRef = db.collection('bookings').doc(bookingId);
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    const [mainDoc, userDoc] = await Promise.all([
      mainBookingRef.get(),
      userBookingRef.get()
    ]);
    
    const result = {
      bookingId,
      userId,
      mainExists: mainDoc.exists,
      userExists: userDoc.exists,
      inSync: false,
      lastSync: null,
      statusMatch: false
    };
    
    if (mainDoc.exists && userDoc.exists) {
      const mainData = mainDoc.data();
      const userData = userDoc.data();
      
      result.statusMatch = mainData.assignedStatus === userData.assignedStatus;
      result.inSync = result.statusMatch;
      result.lastSync = userData.lastSyncAt || userData.mirroredAt;
      result.mainStatus = mainData.assignedStatus;
      result.userStatus = userData.assignedStatus;
    }
    
    return result;
    
  } catch (error) {
    console.error(`❌ Error getting sync status for ${bookingId}:`, error);
    return {
      bookingId,
      userId,
      error: error.message
    };
  }
}

module.exports = {
  syncAssignedStatus,
  createMissingMirroredBooking,
  syncBookingUpdate,
  validateStatusSync,
  forceSyncBooking,
  getSyncStatus
};

