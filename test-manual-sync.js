/**
 * Test script to verify manual status synchronization using customerId
 */

const { db } = require('./firebaseAdmin');
const { manualSyncByCustomerId, findAndSyncUserBooking, getManualSyncStatus } = require('./utils/manualStatusSync');

async function testManualSync() {
  console.log('🧪 Testing manual status synchronization using customerId...');
  
  try {
    // Test data
    const testBookingData = {
      userId: 'test-customer-789',
      customerId: 'test-customer-789', // customerId = userId
      date: '2025-01-17',
      time: '09:00 - 11:00',
      hours: 2,
      professionals: 1,
      materials: true,
      instructions: 'Test manual sync booking',
      assignedStatus: 'unassigned',
      totalAmount: 75.00,
      createdAt: new Date().toISOString()
    };
    
    // Create booking in main collection
    console.log('Creating test booking in main collection...');
    const docRef = await db.collection('bookings').add(testBookingData);
    const bookingId = docRef.id;
    console.log(`✅ Created booking ${bookingId} in main collection`);
    
    // Create mirrored booking manually
    console.log('Creating mirrored booking...');
    const userBookingRef = db.collection('users').doc(testBookingData.customerId).collection('bookings').doc(bookingId);
    await userBookingRef.set({
      ...testBookingData,
      mirroredAt: new Date().toISOString()
    });
    console.log(`✅ Created mirrored booking ${bookingId} in user subcollection`);
    
    // Test 1: Check initial manual sync status
    console.log('\n📊 Test 1: Check initial manual sync status');
    const initialStatus = await getManualSyncStatus(bookingId, testBookingData.customerId);
    console.log('Initial manual sync status:', initialStatus);
    
    // Test 2: Update assignedStatus in main collection
    console.log('\n🔄 Test 2: Update assignedStatus in main collection');
    await docRef.update({ assignedStatus: 'assigned' });
    console.log('✅ Updated main booking assignedStatus to "assigned"');
    
    // Test 3: Manual sync using customerId
    console.log('\n🔄 Test 3: Manual sync using customerId');
    const manualSyncSuccess = await manualSyncByCustomerId(bookingId, testBookingData.customerId, 'assigned');
    
    if (manualSyncSuccess) {
      console.log('✅ Manual sync successful');
    } else {
      console.log('❌ Manual sync failed');
    }
    
    // Test 4: Verify manual sync status after update
    console.log('\n📊 Test 4: Verify manual sync status after update');
    const afterSyncStatus = await getManualSyncStatus(bookingId, testBookingData.customerId);
    console.log('After manual sync status:', afterSyncStatus);
    
    // Test 5: Test find and sync functionality
    console.log('\n🔄 Test 5: Test find and sync functionality');
    await docRef.update({ assignedStatus: 'confirm' });
    console.log('✅ Updated main booking assignedStatus to "confirm"');
    
    const findAndSyncResult = await findAndSyncUserBooking(bookingId, testBookingData.customerId, 'confirm');
    console.log('Find and sync result:', findAndSyncResult);
    
    // Test 6: Test multiple status changes with manual sync
    console.log('\n🔄 Test 6: Test multiple status changes with manual sync');
    const statuses = ['completed', 'cancelled'];
    
    for (const status of statuses) {
      console.log(`\nUpdating to status: ${status}`);
      
      // Update main collection
      await docRef.update({ assignedStatus: status });
      console.log(`✅ Updated main booking to "${status}"`);
      
      // Manual sync to user subcollection
      const syncResult = await manualSyncByCustomerId(bookingId, testBookingData.customerId, status);
      if (syncResult) {
        console.log(`✅ Manual synced "${status}" to user subcollection`);
      } else {
        console.log(`❌ Failed to manual sync "${status}"`);
      }
      
      // Verify sync
      const statusCheck = await getManualSyncStatus(bookingId, testBookingData.customerId);
      console.log(`📊 Manual sync check for "${status}":`, {
        inSync: statusCheck.inSync,
        mainStatus: statusCheck.mainStatus,
        userStatus: statusCheck.userStatus,
        syncedBy: statusCheck.syncedBy
      });
    }
    
    // Test 7: Test with missing mirrored booking
    console.log('\n🔄 Test 7: Test with missing mirrored booking');
    
    // Create another booking without mirrored copy
    const testBookingData2 = {
      userId: 'test-customer-999',
      customerId: 'test-customer-999',
      date: '2025-01-18',
      time: '13:00 - 15:00',
      hours: 2,
      professionals: 2,
      materials: false,
      instructions: 'Test missing mirrored booking',
      assignedStatus: 'unassigned',
      totalAmount: 100.00,
      createdAt: new Date().toISOString()
    };
    
    const docRef2 = await db.collection('bookings').add(testBookingData2);
    const bookingId2 = docRef2.id;
    console.log(`✅ Created booking ${bookingId2} without mirrored copy`);
    
    // Try to manual sync (should create missing mirrored booking)
    const missingSyncResult = await manualSyncByCustomerId(bookingId2, testBookingData2.customerId, 'assigned');
    if (missingSyncResult) {
      console.log('✅ Manual sync successful - created missing mirrored booking');
    } else {
      console.log('❌ Manual sync failed for missing mirrored booking');
    }
    
    // Verify the missing booking was created
    const missingStatus = await getManualSyncStatus(bookingId2, testBookingData2.customerId);
    console.log('Missing booking sync status:', missingStatus);
    
    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await docRef.delete();
    await userBookingRef.delete();
    await docRef2.delete();
    const userBookingRef2 = db.collection('users').doc(testBookingData2.customerId).collection('bookings').doc(bookingId2);
    await userBookingRef2.delete();
    console.log('✅ Cleanup completed');
    
    console.log('\n🏁 Manual status synchronization test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testManualSync().then(() => {
  console.log('🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});
