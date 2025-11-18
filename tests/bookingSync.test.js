/**
 * Booking Synchronization Tests
 * 
 * This module contains tests to validate the booking synchronization
 * functionality between main collection and user subcollections.
 */

const { db } = require('../firebaseAdmin');
const { 
  createMirroredBooking, 
  syncAssignedStatus, 
  syncBookingUpdate,
  deleteMirroredBooking,
  repairMirroredBooking,
  validateBookingSync
} = require('../utils/bookingSync');

/**
 * Test data for booking operations
 */
const testBookingData = {
  userId: 'test-user-123',
  customerId: 'test-user-123',
  date: '2025-01-15',
  time: '10:00 - 12:00',
  hours: 2,
  professionals: 2,
  materials: true,
  instructions: 'Test booking instructions',
  assignedStatus: 'unassigned',
  totalAmount: 150.00,
  createdAt: new Date().toISOString()
};

/**
 * Test: Create mirrored booking
 */
async function testCreateMirroredBooking() {
  console.log('🧪 Testing createMirroredBooking...');
  
  try {
    // Create a test booking in main collection
    const mainBookingRef = await db.collection('bookings').add(testBookingData);
    const bookingId = mainBookingRef.id;
    
    console.log(`Created test booking ${bookingId} in main collection`);
    
    // Create mirrored booking
    const success = await createMirroredBooking(bookingId, testBookingData.userId, testBookingData);
    
    if (success) {
      console.log('✅ createMirroredBooking test passed');
      
      // Verify the mirrored booking exists
      const userBookingRef = db.collection('users').doc(testBookingData.userId).collection('bookings').doc(bookingId);
      const userBookingDoc = await userBookingRef.get();
      
      if (userBookingDoc.exists) {
        console.log('✅ Mirrored booking verified in user subcollection');
      } else {
        console.log('❌ Mirrored booking not found in user subcollection');
      }
    } else {
      console.log('❌ createMirroredBooking test failed');
    }
    
    // Cleanup
    await mainBookingRef.delete();
    await userBookingRef.delete();
    console.log('🧹 Cleaned up test data');
    
  } catch (error) {
    console.error('❌ testCreateMirroredBooking error:', error);
  }
}

/**
 * Test: Sync assigned status
 */
async function testSyncAssignedStatus() {
  console.log('🧪 Testing syncAssignedStatus...');
  
  try {
    // Create test booking in main collection
    const mainBookingRef = await db.collection('bookings').add(testBookingData);
    const bookingId = mainBookingRef.id;
    
    // Create mirrored booking
    await createMirroredBooking(bookingId, testBookingData.userId, testBookingData);
    
    // Update assignedStatus in main collection
    await mainBookingRef.update({ assignedStatus: 'assigned' });
    
    // Sync the status
    const success = await syncAssignedStatus(bookingId, testBookingData.userId, 'assigned');
    
    if (success) {
      console.log('✅ syncAssignedStatus test passed');
      
      // Verify the sync
      const userBookingRef = db.collection('users').doc(testBookingData.userId).collection('bookings').doc(bookingId);
      const userBookingDoc = await userBookingRef.get();
      const userData = userBookingDoc.data();
      
      if (userData.assignedStatus === 'assigned') {
        console.log('✅ AssignedStatus sync verified');
      } else {
        console.log('❌ AssignedStatus sync failed');
      }
    } else {
      console.log('❌ syncAssignedStatus test failed');
    }
    
    // Cleanup
    await mainBookingRef.delete();
    await userBookingRef.delete();
    console.log('🧹 Cleaned up test data');
    
  } catch (error) {
    console.error('❌ testSyncAssignedStatus error:', error);
  }
}

/**
 * Test: Validate booking sync
 */
async function testValidateBookingSync() {
  console.log('🧪 Testing validateBookingSync...');
  
  try {
    // Create test booking in main collection
    const mainBookingRef = await db.collection('bookings').add(testBookingData);
    const bookingId = mainBookingRef.id;
    
    // Create mirrored booking
    await createMirroredBooking(bookingId, testBookingData.userId, testBookingData);
    
    // Validate sync
    const validation = await validateBookingSync(bookingId, testBookingData.userId);
    
    if (validation.isValid) {
      console.log('✅ validateBookingSync test passed - bookings are in sync');
    } else {
      console.log('❌ validateBookingSync test failed:', validation.message);
    }
    
    // Test with mismatched status
    await mainBookingRef.update({ assignedStatus: 'confirmed' });
    const validation2 = await validateBookingSync(bookingId, testBookingData.userId);
    
    if (!validation2.isValid && validation2.status === 'status_mismatch') {
      console.log('✅ validateBookingSync correctly detected status mismatch');
    } else {
      console.log('❌ validateBookingSync failed to detect status mismatch');
    }
    
    // Cleanup
    await mainBookingRef.delete();
    const userBookingRef = db.collection('users').doc(testBookingData.userId).collection('bookings').doc(bookingId);
    await userBookingRef.delete();
    console.log('🧹 Cleaned up test data');
    
  } catch (error) {
    console.error('❌ testValidateBookingSync error:', error);
  }
}

/**
 * Test: Repair mirrored booking
 */
async function testRepairMirroredBooking() {
  console.log('🧪 Testing repairMirroredBooking...');
  
  try {
    // Create test booking in main collection only
    const mainBookingRef = await db.collection('bookings').add(testBookingData);
    const bookingId = mainBookingRef.id;
    
    // Try to repair (should create the missing mirrored booking)
    const success = await repairMirroredBooking(bookingId, testBookingData.userId);
    
    if (success) {
      console.log('✅ repairMirroredBooking test passed');
      
      // Verify the repair
      const userBookingRef = db.collection('users').doc(testBookingData.userId).collection('bookings').doc(bookingId);
      const userBookingDoc = await userBookingRef.get();
      
      if (userBookingDoc.exists) {
        console.log('✅ Repaired mirrored booking verified');
      } else {
        console.log('❌ Repaired mirrored booking not found');
      }
    } else {
      console.log('❌ repairMirroredBooking test failed');
    }
    
    // Cleanup
    await mainBookingRef.delete();
    await userBookingRef.delete();
    console.log('🧹 Cleaned up test data');
    
  } catch (error) {
    console.error('❌ testRepairMirroredBooking error:', error);
  }
}

/**
 * Test: Delete mirrored booking
 */
async function testDeleteMirroredBooking() {
  console.log('🧪 Testing deleteMirroredBooking...');
  
  try {
    // Create test booking in main collection
    const mainBookingRef = await db.collection('bookings').add(testBookingData);
    const bookingId = mainBookingRef.id;
    
    // Create mirrored booking
    await createMirroredBooking(bookingId, testBookingData.userId, testBookingData);
    
    // Delete mirrored booking
    const success = await deleteMirroredBooking(bookingId, testBookingData.userId);
    
    if (success) {
      console.log('✅ deleteMirroredBooking test passed');
      
      // Verify deletion
      const userBookingRef = db.collection('users').doc(testBookingData.userId).collection('bookings').doc(bookingId);
      const userBookingDoc = await userBookingRef.get();
      
      if (!userBookingDoc.exists) {
        console.log('✅ Mirrored booking deletion verified');
      } else {
        console.log('❌ Mirrored booking still exists after deletion');
      }
    } else {
      console.log('❌ deleteMirroredBooking test failed');
    }
    
    // Cleanup
    await mainBookingRef.delete();
    console.log('🧹 Cleaned up test data');
    
  } catch (error) {
    console.error('❌ testDeleteMirroredBooking error:', error);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🚀 Starting Booking Synchronization Tests...\n');
  
  await testCreateMirroredBooking();
  console.log('');
  
  await testSyncAssignedStatus();
  console.log('');
  
  await testValidateBookingSync();
  console.log('');
  
  await testRepairMirroredBooking();
  console.log('');
  
  await testDeleteMirroredBooking();
  console.log('');
  
  console.log('🏁 All tests completed!');
}

// Export for use in other modules
module.exports = {
  testCreateMirroredBooking,
  testSyncAssignedStatus,
  testValidateBookingSync,
  testRepairMirroredBooking,
  testDeleteMirroredBooking,
  runAllTests
};

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

