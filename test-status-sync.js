/**
 * Test script to verify assignedStatus synchronization
 */

const { db } = require('./firebaseAdmin');
const { syncAssignedStatus, getSyncStatus, forceSyncBooking } = require('./utils/statusSync');

async function testStatusSync() {
  console.log('🧪 Testing assignedStatus synchronization...');
  
  try {
    // Test data
    const testBookingData = {
      userId: 'test-user-456',
      customerId: 'test-user-456',
      date: '2025-01-16',
      time: '14:00 - 16:00',
      hours: 2,
      professionals: 1,
      materials: false,
      instructions: 'Test status sync booking',
      assignedStatus: 'unassigned',
      totalAmount: 100.00,
      createdAt: new Date().toISOString()
    };
    
    // Create booking in main collection
    console.log('Creating test booking in main collection...');
    const docRef = await db.collection('bookings').add(testBookingData);
    const bookingId = docRef.id;
    console.log(`✅ Created booking ${bookingId} in main collection`);
    
    // Create mirrored booking manually
    console.log('Creating mirrored booking...');
    const userBookingRef = db.collection('users').doc(testBookingData.userId).collection('bookings').doc(bookingId);
    await userBookingRef.set({
      ...testBookingData,
      mirroredAt: new Date().toISOString()
    });
    console.log(`✅ Created mirrored booking ${bookingId} in user subcollection`);
    
    // Test 1: Check initial sync status
    console.log('\n📊 Test 1: Check initial sync status');
    const initialStatus = await getSyncStatus(bookingId, testBookingData.userId);
    console.log('Initial sync status:', initialStatus);
    
    // Test 2: Update assignedStatus in main collection
    console.log('\n🔄 Test 2: Update assignedStatus in main collection');
    await docRef.update({ assignedStatus: 'assigned' });
    console.log('✅ Updated main booking assignedStatus to "assigned"');
    
    // Test 3: Sync the status to user subcollection
    console.log('\n🔄 Test 3: Sync assignedStatus to user subcollection');
    const syncSuccess = await syncAssignedStatus(bookingId, testBookingData.userId, 'assigned');
    
    if (syncSuccess) {
      console.log('✅ Status sync successful');
    } else {
      console.log('❌ Status sync failed');
    }
    
    // Test 4: Verify sync status after update
    console.log('\n📊 Test 4: Verify sync status after update');
    const afterSyncStatus = await getSyncStatus(bookingId, testBookingData.userId);
    console.log('After sync status:', afterSyncStatus);
    
    // Test 5: Test multiple status changes
    console.log('\n🔄 Test 5: Test multiple status changes');
    const statuses = ['confirm', 'completed', 'cancelled'];
    
    for (const status of statuses) {
      console.log(`\nUpdating to status: ${status}`);
      
      // Update main collection
      await docRef.update({ assignedStatus: status });
      console.log(`✅ Updated main booking to "${status}"`);
      
      // Sync to user subcollection
      const syncResult = await syncAssignedStatus(bookingId, testBookingData.userId, status);
      if (syncResult) {
        console.log(`✅ Synced "${status}" to user subcollection`);
      } else {
        console.log(`❌ Failed to sync "${status}"`);
      }
      
      // Verify sync
      const statusCheck = await getSyncStatus(bookingId, testBookingData.userId);
      console.log(`📊 Sync check for "${status}":`, {
        inSync: statusCheck.inSync,
        mainStatus: statusCheck.mainStatus,
        userStatus: statusCheck.userStatus
      });
    }
    
    // Test 6: Force sync test
    console.log('\n🔄 Test 6: Force sync test');
    await docRef.update({ 
      assignedStatus: 'force-test',
      totalAmount: 200.00,
      instructions: 'Force sync test instructions'
    });
    console.log('✅ Updated main booking with multiple fields');
    
    const forceSyncResult = await forceSyncBooking(bookingId, testBookingData.userId);
    if (forceSyncResult) {
      console.log('✅ Force sync successful');
    } else {
      console.log('❌ Force sync failed');
    }
    
    // Final status check
    console.log('\n📊 Final status check');
    const finalStatus = await getSyncStatus(bookingId, testBookingData.userId);
    console.log('Final sync status:', finalStatus);
    
    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await docRef.delete();
    await userBookingRef.delete();
    console.log('✅ Cleanup completed');
    
    console.log('\n🏁 Status synchronization test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testStatusSync().then(() => {
  console.log('🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});

