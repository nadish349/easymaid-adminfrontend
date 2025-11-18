/**
 * Firestore Triggers for Booking Synchronization
 * 
 * This module contains Cloud Functions triggers that automatically
 * maintain data consistency between the main bookings collection
 * and user subcollections.
 */

const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');
const { db } = require('../firebaseAdmin');
const { 
  createMirroredBooking, 
  syncAssignedStatus, 
  deleteMirroredBooking 
} = require('../utils/bookingSync');

/**
 * Trigger: When a new booking is created in the main collection
 * Action: Create a mirrored copy in the user's subcollection
 */
exports.onBookingCreated = onDocumentCreated({
  document: 'bookings/{bookingId}',
  region: 'us-central1'
}, async (event) => {
  const bookingId = event.params.bookingId;
  const bookingData = event.data.data();
  
  logger.info(`Trigger: New booking created - ${bookingId}`, { bookingId, userId: bookingData.userId });
  
  try {
    // Validate required fields
    if (!bookingData.userId) {
      logger.error(`Booking ${bookingId} missing userId field`);
      return;
    }
    
    // Create mirrored booking
    const success = await createMirroredBooking(bookingId, bookingData.userId, bookingData);
    
    if (success) {
      logger.info(`✅ Successfully created mirrored booking ${bookingId} for user ${bookingData.userId}`);
    } else {
      logger.error(`❌ Failed to create mirrored booking ${bookingId} for user ${bookingData.userId}`);
    }
  } catch (error) {
    logger.error(`Error in onBookingCreated trigger for ${bookingId}:`, error);
  }
});

/**
 * Trigger: When a booking is updated in the main collection
 * Action: Sync the assignedStatus field to the user's subcollection
 */
exports.onBookingUpdated = onDocumentUpdated({
  document: 'bookings/{bookingId}',
  region: 'us-central1'
}, async (event) => {
  const bookingId = event.params.bookingId;
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();
  
  logger.info(`Trigger: Booking updated - ${bookingId}`, { 
    bookingId, 
    userId: afterData.userId,
    assignedStatusChanged: beforeData.assignedStatus !== afterData.assignedStatus
  });
  
  try {
    // Check if assignedStatus was updated
    if (beforeData.assignedStatus !== afterData.assignedStatus && afterData.userId) {
      const success = await syncAssignedStatus(bookingId, afterData.userId, afterData.assignedStatus);
      
      if (success) {
        logger.info(`✅ Successfully synced assignedStatus for booking ${bookingId}`);
      } else {
        logger.error(`❌ Failed to sync assignedStatus for booking ${bookingId}`);
      }
    }
    
    // Log other field changes for monitoring
    const changedFields = [];
    Object.keys(afterData).forEach(key => {
      if (beforeData[key] !== afterData[key]) {
        changedFields.push(key);
      }
    });
    
    if (changedFields.length > 0) {
      logger.info(`Booking ${bookingId} fields changed:`, { changedFields });
    }
  } catch (error) {
    logger.error(`Error in onBookingUpdated trigger for ${bookingId}:`, error);
  }
});

/**
 * Trigger: When a booking is deleted from the main collection
 * Action: Delete the mirrored copy from the user's subcollection
 */
exports.onBookingDeleted = onDocumentDeleted({
  document: 'bookings/{bookingId}',
  region: 'us-central1'
}, async (event) => {
  const bookingId = event.params.bookingId;
  const bookingData = event.data.data();
  
  logger.info(`Trigger: Booking deleted - ${bookingId}`, { bookingId, userId: bookingData.userId });
  
  try {
    if (bookingData.userId) {
      const success = await deleteMirroredBooking(bookingId, bookingData.userId);
      
      if (success) {
        logger.info(`✅ Successfully deleted mirrored booking ${bookingId} for user ${bookingData.userId}`);
      } else {
        logger.error(`❌ Failed to delete mirrored booking ${bookingId} for user ${bookingData.userId}`);
      }
    } else {
      logger.warn(`Booking ${bookingId} deleted but no userId found for cleanup`);
    }
  } catch (error) {
    logger.error(`Error in onBookingDeleted trigger for ${bookingId}:`, error);
  }
});

/**
 * Trigger: When a user booking is updated in subcollection
 * Action: Log the change for monitoring (optional - for debugging)
 */
exports.onUserBookingUpdated = onDocumentUpdated({
  document: 'users/{userId}/bookings/{bookingId}',
  region: 'us-central1'
}, async (event) => {
  const userId = event.params.userId;
  const bookingId = event.params.bookingId;
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();
  
  // Only log if this wasn't triggered by our own sync operations
  if (afterData.mirroredAt || afterData.updatedAt) {
    logger.info(`User booking updated - ${userId}/${bookingId}`, {
      userId,
      bookingId,
      assignedStatus: afterData.assignedStatus,
      updatedAt: afterData.updatedAt
    });
  }
});

/**
 * Health check function to validate booking synchronization
 * This can be called periodically to ensure data consistency
 */
exports.validateBookingSync = async (bookingId, userId) => {
  try {
    const mainBookingRef = db.collection('bookings').doc(bookingId);
    const userBookingRef = db.collection('users').doc(userId).collection('bookings').doc(bookingId);
    
    const [mainDoc, userDoc] = await Promise.all([
      mainBookingRef.get(),
      userBookingRef.get()
    ]);
    
    if (!mainDoc.exists) {
      return { isValid: false, reason: 'Main booking not found' };
    }
    
    if (!userDoc.exists) {
      return { isValid: false, reason: 'Mirrored booking not found' };
    }
    
    const mainData = mainDoc.data();
    const userData = userDoc.data();
    
    if (mainData.assignedStatus !== userData.assignedStatus) {
      return { 
        isValid: false, 
        reason: `assignedStatus mismatch: main='${mainData.assignedStatus}', user='${userData.assignedStatus}'` 
      };
    }
    
    return { isValid: true, reason: 'Bookings are in sync' };
  } catch (error) {
    logger.error(`Error validating booking sync for ${bookingId}:`, error);
    return { isValid: false, reason: error.message };
  }
};

