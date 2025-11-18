/**
 * Manual Status Synchronization Controller
 * 
 * This module handles manual synchronization of assignedStatus using customerId
 * to find the user and sync the booking status to their subcollection.
 */

const { db } = require('../firebaseAdmin');

/**
 * Manual sync assignedStatus and multi-crew fields using customerId to find user
 * @param {string} bookingId - The booking document ID
 * @param {string} customerId - The customer ID (same as userId)
 * @param {string} assignedStatus - The new assigned status
 * @param {Object} additionalFields - Additional fields to sync (e.g., assignedCrews, professionalsAssigned, confirmedCrews, professionalsConfirmed)
 * @returns {Promise<boolean>} - Success status
 */
async function manualSyncByCustomerId(bookingId, customerId, assignedStatus, additionalFields = {}) {
  try {
    console.log(`🔄 MANUAL SYNC: Starting sync for booking ${bookingId}, customerId: ${customerId}, status: ${assignedStatus}`);
    
    // Step 1: Verify the main booking exists and get its data
    const mainBookingRef = db.collection('bookings').doc(bookingId);
    const mainBookingDoc = await mainBookingRef.get();
    
    if (!mainBookingDoc.exists) {
      console.error(`❌ MANUAL SYNC: Main booking ${bookingId} not found`);
      return false;
    }
    
    const mainBookingData = mainBookingDoc.data();
    console.log(`📋 MANUAL SYNC: Main booking data:`, {
      id: bookingId,
      customerId: mainBookingData.customerId,
      userId: mainBookingData.userId,
      currentStatus: mainBookingData.assignedStatus,
      newStatus: assignedStatus
    });
    
    // Step 2: Use customerId to find the user (customerId should be same as userId)
    const userId = customerId; // In your system, customerId = userId
    console.log(`🔍 MANUAL SYNC: Using customerId ${customerId} as userId ${userId}`);
    
    // Step 3: Check if user exists
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.error(`❌ MANUAL SYNC: User ${userId} not found`);
      return false;
    }
    
    console.log(`✅ MANUAL SYNC: User ${userId} found`);
    
    // Step 4: Look for the booking in user's subcollection
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    const userBookingDoc = await userBookingRef.get();
    
    if (!userBookingDoc.exists) {
      console.warn(`⚠️ MANUAL SYNC: Booking ${bookingId} not found in user ${userId} subcollection`);
      
      // Try to create the missing mirrored booking
      console.log(`🔧 MANUAL SYNC: Attempting to create missing mirrored booking...`);
      const createSuccess = await createMissingMirroredBooking(bookingId, userId, mainBookingData);
      if (!createSuccess) {
        console.error(`❌ MANUAL SYNC: Failed to create missing mirrored booking`);
        return false;
      }
    }
    
    // Step 5: Update the assignedStatus and multi-crew fields in user's subcollection
    const updateData = {
      assignedStatus: assignedStatus,
      updatedAt: new Date().toISOString(),
      lastManualSyncAt: new Date().toISOString(),
      syncedBy: 'manual-sync',
      ...additionalFields // Include any additional fields like assignedCrews, confirmedCrews, etc.
    };
    
    await userBookingRef.update(updateData);
    
    console.log(`✅ MANUAL SYNC: Successfully synced status and fields for booking ${bookingId} in user ${userId} subcollection`, updateData);
    return true;
    
  } catch (error) {
    console.error(`❌ MANUAL SYNC: Error syncing assignedStatus for booking ${bookingId} with customerId ${customerId}:`, error);
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
      lastManualSyncAt: new Date().toISOString(),
      syncedBy: 'manual-sync'
    };
    
    await userBookingRef.set(mirroredData);
    console.log(`✅ MANUAL SYNC: Created missing mirrored booking ${bookingId} for user ${userId}`);
    return true;
    
  } catch (error) {
    console.error(`❌ MANUAL SYNC: Error creating missing mirrored booking ${bookingId} for user ${userId}:`, error);
    return false;
  }
}

/**
 * Find and sync user booking by customerId
 * @param {string} bookingId - The booking document ID
 * @param {string} customerId - The customer ID
 * @param {string} assignedStatus - The new assigned status
 * @returns {Promise<Object>} - Sync result with details
 */
async function findAndSyncUserBooking(bookingId, customerId, assignedStatus) {
  try {
    console.log(`🔍 FIND & SYNC: Looking for booking ${bookingId} with customerId ${customerId}`);
    
    // Get main booking data
    const mainBookingRef = db.collection('bookings').doc(bookingId);
    const mainBookingDoc = await mainBookingRef.get();
    
    if (!mainBookingDoc.exists) {
      return {
        success: false,
        error: 'Main booking not found',
        bookingId,
        customerId
      };
    }
    
    const mainData = mainBookingDoc.data();
    const userId = customerId; // customerId = userId in your system
    
    // Check if user exists
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return {
        success: false,
        error: 'User not found',
        bookingId,
        customerId,
        userId
      };
    }
    
    // Check if booking exists in user subcollection
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    const userBookingDoc = await userBookingRef.get();
    
    if (!userBookingDoc.exists) {
      // Create missing booking
      const createSuccess = await createMissingMirroredBooking(bookingId, userId, mainData);
      if (!createSuccess) {
        return {
          success: false,
          error: 'Failed to create missing mirrored booking',
          bookingId,
          customerId,
          userId
        };
      }
    }
    
    // Update the status
    await userBookingRef.update({
      assignedStatus: assignedStatus,
      updatedAt: new Date().toISOString(),
      lastManualSyncAt: new Date().toISOString(),
      syncedBy: 'find-and-sync'
    });
    
    return {
      success: true,
      message: `Successfully synced booking ${bookingId} for user ${userId}`,
      bookingId,
      customerId,
      userId,
      assignedStatus
    };
    
  } catch (error) {
    console.error(`❌ FIND & SYNC: Error finding and syncing booking ${bookingId}:`, error);
    return {
      success: false,
      error: error.message,
      bookingId,
      customerId
    };
  }
}

/**
 * Sync all bookings for a specific customer
 * @param {string} customerId - The customer ID
 * @param {string} assignedStatus - The new assigned status
 * @returns {Promise<Object>} - Sync result with count
 */
async function syncAllCustomerBookings(customerId, assignedStatus) {
  try {
    console.log(`🔄 SYNC ALL: Syncing all bookings for customer ${customerId} to status ${assignedStatus}`);
    
    // Get all bookings for this customer
    const bookingsSnapshot = await db.collection('bookings')
      .where('customerId', '==', customerId)
      .get();
    
    if (bookingsSnapshot.empty) {
      return {
        success: true,
        message: `No bookings found for customer ${customerId}`,
        syncedCount: 0
      };
    }
    
    const userId = customerId;
    const userBookingRef = db.collection('users').doc(userId).collection('bookings');
    let syncedCount = 0;
    const errors = [];
    
    // Process each booking
    for (const bookingDoc of bookingsSnapshot.docs) {
      const bookingId = bookingDoc.id;
      const bookingData = bookingDoc.data();
      
      try {
        // Update in user subcollection
        await userBookingRef.doc(bookingId).update({
          assignedStatus: assignedStatus,
          updatedAt: new Date().toISOString(),
          lastManualSyncAt: new Date().toISOString(),
          syncedBy: 'sync-all-customer'
        });
        
        syncedCount++;
        console.log(`✅ SYNC ALL: Synced booking ${bookingId} for customer ${customerId}`);
        
      } catch (error) {
        console.error(`❌ SYNC ALL: Error syncing booking ${bookingId}:`, error);
        errors.push({ bookingId, error: error.message });
      }
    }
    
    return {
      success: true,
      message: `Synced ${syncedCount} bookings for customer ${customerId}`,
      syncedCount,
      totalBookings: bookingsSnapshot.size,
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    console.error(`❌ SYNC ALL: Error syncing all bookings for customer ${customerId}:`, error);
    return {
      success: false,
      error: error.message,
      customerId
    };
  }
}

/**
 * Get sync status for a booking by customerId
 * @param {string} bookingId - The booking document ID
 * @param {string} customerId - The customer ID
 * @returns {Promise<Object>} - Sync status information
 */
async function getManualSyncStatus(bookingId, customerId) {
  try {
    const userId = customerId;
    
    const mainBookingRef = db.collection('bookings').doc(bookingId);
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    const [mainDoc, userDoc] = await Promise.all([
      mainBookingRef.get(),
      userBookingRef.get()
    ]);
    
    const result = {
      bookingId,
      customerId,
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
      result.lastSync = userData.lastManualSyncAt || userData.mirroredAt;
      result.mainStatus = mainData.assignedStatus;
      result.userStatus = userData.assignedStatus;
      result.syncedBy = userData.syncedBy;
    }
    
    return result;
    
  } catch (error) {
    console.error(`❌ MANUAL SYNC STATUS: Error getting sync status for ${bookingId}:`, error);
    return {
      bookingId,
      customerId,
      error: error.message
    };
  }
}

module.exports = {
  manualSyncByCustomerId,
  createMissingMirroredBooking,
  findAndSyncUserBooking,
  syncAllCustomerBookings,
  getManualSyncStatus
};
