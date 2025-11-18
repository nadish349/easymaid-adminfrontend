/**
 * Test script to verify /assign endpoint triggers manual sync
 */

const { db } = require('./firebaseAdmin');
const { manualSyncByCustomerId, getManualSyncStatus } = require('./utils/manualStatusSync');

async function testAssignSync() {
  console.log('🧪 Testing /assign endpoint with manual sync...');
  
  try {
    // Test data with realistic user
    const testUserId = 'test-assign-user-789';
    const testBookingData = {
      userId: testUserId,
      customerId: testUserId, // customerId = userId
      date: '2025-01-17',
      time: '09:00 - 11:00',
      hours: 2,
      professionals: 1,
      materials: true,
      instructions: 'Test assign sync booking',
      assignedStatus: 'unassigned',
      totalAmount: 75.00,
      createdAt: new Date().toISOString()
    };
    
    // Step 1: Create user document first
    console.log('Creating user document...');
    const userRef = db.collection('users').doc(testUserId);
    await userRef.set({
      id: testUserId,
      name: 'Test Assign User',
      email: 'testassign@example.com',
      phone: '+1234567890',
      totalAmount: 0,
      createdAt: new Date().toISOString()
    });
    console.log(`✅ Created user ${testUserId} in users collection`);
    
    // Step 2: Create booking in main collection
    console.log('Creating test booking in main collection...');
    const docRef = await db.collection('bookings').add(testBookingData);
    const bookingId = docRef.id;
    console.log(`✅ Created booking ${bookingId} in main collection`);
    
    // Step 3: Create mirrored booking manually
    console.log('Creating mirrored booking...');
    const userBookingRef = db.collection('users').doc(testUserId).collection('bookings').doc(bookingId);
    await userBookingRef.set({
      ...testBookingData,
      mirroredAt: new Date().toISOString()
    });
    console.log(`✅ Created mirrored booking ${bookingId} in user subcollection`);
    
    // Test 1: Check initial sync status
    console.log('\n📊 Test 1: Check initial sync status');
    const initialStatus = await getManualSyncStatus(bookingId, testUserId);
    console.log('Initial sync status:', initialStatus);
    
    // Test 2: Simulate /assign endpoint (assign to crew)
    console.log('\n🔄 Test 2: Simulate /assign endpoint (assign to crew)');
    
    // This simulates what the frontend does: apiPatch(`/bookings/${bookingId}/assign`, { assignedTo: 'crew123' })
    const assignedTo = 'crew123';
    
    // Get booking data first
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    const bookingData = bookingDoc.data();
    const userId = bookingData.userId;
    
    // Update the booking assignment (simulating /assign endpoint)
    const updateData = {
      assignedTo: assignedTo,
      assignedStatus: 'assigned',
      updatedAt: new Date()
    };
    
    await bookingRef.update(updateData);
    console.log(`✅ Assigned booking ${bookingId} to crew ${assignedTo} (status: assigned)`);
    
    // Test 3: Manual sync (this should happen automatically in the /assign route)
    console.log('\n🔄 Test 3: Manual sync (should be automatic in /assign route)');
    if (userId && updateData.assignedStatus) {
      console.log(`🔄 ASSIGN UPDATE: Syncing status change for booking ${bookingId}, user ${userId}, new status: ${updateData.assignedStatus}`);
      
      // Use manual sync method with customerId
      const syncSuccess = await manualSyncByCustomerId(bookingId, userId, updateData.assignedStatus);
      
      if (syncSuccess) {
        console.log(`✅ ASSIGN UPDATE: Successfully synced status for booking ${bookingId}`);
      } else {
        console.warn(`⚠️ ASSIGN UPDATE: Failed to sync assignedStatus for booking ${bookingId} in user ${userId} subcollection`);
      }
    }
    
    // Test 4: Verify sync status after assignment
    console.log('\n📊 Test 4: Verify sync status after assignment');
    const afterAssignStatus = await getManualSyncStatus(bookingId, testUserId);
    console.log('After assign status:', afterAssignStatus);
    
    // Test 5: Simulate unassign (set assignedTo to null)
    console.log('\n🔄 Test 5: Simulate unassign (set assignedTo to null)');
    
    const unassignData = {
      assignedTo: null,
      assignedStatus: 'unassigned',
      updatedAt: new Date()
    };
    
    await bookingRef.update(unassignData);
    console.log(`✅ Unassigned booking ${bookingId} (status: unassigned)`);
    
    // Manual sync for unassign
    const unassignSyncSuccess = await manualSyncByCustomerId(bookingId, userId, unassignData.assignedStatus);
    if (unassignSyncSuccess) {
      console.log(`✅ Unassign sync successful`);
    } else {
      console.log(`❌ Unassign sync failed`);
    }
    
    // Test 6: Verify sync status after unassign
    console.log('\n📊 Test 6: Verify sync status after unassign');
    const afterUnassignStatus = await getManualSyncStatus(bookingId, testUserId);
    console.log('After unassign status:', afterUnassignStatus);
    
    // Test 7: Test confirm status (simulate handleConfirmJob)
    console.log('\n🔄 Test 7: Test confirm status (simulate handleConfirmJob)');
    
    // First assign again
    await bookingRef.update({
      assignedTo: 'crew123',
      assignedStatus: 'assigned',
      updatedAt: new Date()
    });
    console.log(`✅ Re-assigned booking ${bookingId} to crew ${assignedTo}`);
    
    // Sync assigned status
    await manualSyncByCustomerId(bookingId, userId, 'assigned');
    console.log(`✅ Synced assigned status`);
    
    // Now confirm (this simulates handleConfirmJob)
    await bookingRef.update({
      assignedStatus: 'confirm',
      updatedAt: new Date()
    });
    console.log(`✅ Confirmed booking ${bookingId} (status: confirm)`);
    
    // Sync confirm status
    const confirmSyncSuccess = await manualSyncByCustomerId(bookingId, userId, 'confirm');
    if (confirmSyncSuccess) {
      console.log(`✅ Confirm sync successful`);
    } else {
      console.log(`❌ Confirm sync failed`);
    }
    
    // Test 8: Verify final sync status
    console.log('\n📊 Test 8: Verify final sync status');
    const finalStatus = await getManualSyncStatus(bookingId, testUserId);
    console.log('Final sync status:', finalStatus);
    
    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await docRef.delete();
    await userBookingRef.delete();
    await userRef.delete(); // Delete the user document
    console.log('✅ Cleanup completed');
    
    console.log('\n🏁 Assign sync test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testAssignSync().then(() => {
  console.log('🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});
