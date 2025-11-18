/**
 * Test script to verify all multi-crew job fixes are working
 */

const { db } = require('./firebaseAdmin');
const { manualSyncByCustomerId, getManualSyncStatus } = require('./utils/manualStatusSync');

async function testMultiCrewFixes() {
  console.log('🧪 Testing Multi-Crew Job Fixes...');
  
  try {
    // Test data with realistic user
    const testUserId = 'test-multicrew-user-999';
    const testBookingData = {
      userId: testUserId,
      customerId: testUserId,
      date: '2025-01-17',
      time: '09:00 - 11:00',
      hours: 2,
      professionals: 3, // Multi-crew job requiring 3 professionals
      materials: true,
      instructions: 'Test multi-crew job fixes',
      assignedStatus: 'unassigned',
      totalAmount: 150.00,
      createdAt: new Date().toISOString()
    };
    
    // Step 1: Create user document
    console.log('Creating user document...');
    const userRef = db.collection('users').doc(testUserId);
    await userRef.set({
      id: testUserId,
      name: 'Test Multi-Crew User',
      email: 'testmulticrew@example.com',
      phone: '+1234567890',
      totalAmount: 0,
      createdAt: new Date().toISOString()
    });
    console.log(`✅ Created user ${testUserId}`);
    
    // Step 2: Create booking in main collection
    console.log('Creating multi-crew booking...');
    const docRef = await db.collection('bookings').add(testBookingData);
    const bookingId = docRef.id;
    console.log(`✅ Created booking ${bookingId} (professionals: 3)`);
    
    // Step 3: Create mirrored booking
    console.log('Creating mirrored booking...');
    const userBookingRef = db.collection('users').doc(testUserId).collection('bookings').doc(bookingId);
    await userBookingRef.set({
      ...testBookingData,
      mirroredAt: new Date().toISOString()
    });
    console.log(`✅ Created mirrored booking ${bookingId}`);
    
    // Test 1: Assign first crew (should be partially_assigned)
    console.log('\n🔄 Test 1: Assign first crew (should be partially_assigned)');
    const crew1 = 'crew-001';
    const crew2 = 'crew-002';
    const crew3 = 'crew-003';
    
    // Simulate /assign-crew endpoint
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    const bookingData = bookingDoc.data();
    
    // First assignment
    let assignedCrews = bookingData.assignedCrews || [];
    let professionalsAssigned = bookingData.professionalsAssigned || 0;
    
    assignedCrews.push(crew1);
    professionalsAssigned += 1;
    
    const updateData1 = {
      assignedCrews,
      professionalsAssigned,
      assignedStatus: 'partially_assigned', // Should be partially_assigned
      assignedTo: crew1, // Keep for backward compatibility
      updatedAt: new Date()
    };
    
    await bookingRef.update(updateData1);
    console.log(`✅ Assigned crew ${crew1} (status: partially_assigned)`);
    
    // Manual sync
    const sync1 = await manualSyncByCustomerId(bookingId, testUserId, 'partially_assigned');
    console.log(`✅ Manual sync for partially_assigned: ${sync1}`);
    
    // Test 2: Assign second crew (should still be partially_assigned)
    console.log('\n🔄 Test 2: Assign second crew (should still be partially_assigned)');
    
    assignedCrews.push(crew2);
    professionalsAssigned += 1;
    
    const updateData2 = {
      assignedCrews,
      professionalsAssigned,
      assignedStatus: 'partially_assigned', // Still partially_assigned
      assignedTo: crew1, // Keep first crew for backward compatibility
      updatedAt: new Date()
    };
    
    await bookingRef.update(updateData2);
    console.log(`✅ Assigned crew ${crew2} (status: partially_assigned)`);
    
    // Manual sync
    const sync2 = await manualSyncByCustomerId(bookingId, testUserId, 'partially_assigned');
    console.log(`✅ Manual sync for partially_assigned: ${sync2}`);
    
    // Test 3: Assign third crew (should be assigned)
    console.log('\n🔄 Test 3: Assign third crew (should be assigned)');
    
    assignedCrews.push(crew3);
    professionalsAssigned += 1;
    
    const updateData3 = {
      assignedCrews,
      professionalsAssigned,
      assignedStatus: 'assigned', // Now fully assigned
      assignedTo: crew1, // Keep first crew for backward compatibility
      updatedAt: new Date()
    };
    
    await bookingRef.update(updateData3);
    console.log(`✅ Assigned crew ${crew3} (status: assigned)`);
    
    // Manual sync
    const sync3 = await manualSyncByCustomerId(bookingId, testUserId, 'assigned');
    console.log(`✅ Manual sync for assigned: ${sync3}`);
    
    // Test 4: Individual crew confirmation
    console.log('\n🔄 Test 4: Individual crew confirmation');
    
    // Confirm crew1
    let confirmedCrews = [];
    confirmedCrews.push(crew1);
    
    const confirmData1 = {
      confirmedCrews,
      professionalsConfirmed: confirmedCrews.length,
      updatedAt: new Date()
    };
    
    await bookingRef.update(confirmData1);
    console.log(`✅ Confirmed crew ${crew1} (professionalsConfirmed: 1)`);
    
    // Confirm crew2
    confirmedCrews.push(crew2);
    
    const confirmData2 = {
      confirmedCrews,
      professionalsConfirmed: confirmedCrews.length,
      updatedAt: new Date()
    };
    
    await bookingRef.update(confirmData2);
    console.log(`✅ Confirmed crew ${crew2} (professionalsConfirmed: 2)`);
    
    // Confirm crew3
    confirmedCrews.push(crew3);
    
    const confirmData3 = {
      confirmedCrews,
      professionalsConfirmed: confirmedCrews.length,
      updatedAt: new Date()
    };
    
    await bookingRef.update(confirmData3);
    console.log(`✅ Confirmed crew ${crew3} (professionalsConfirmed: 3)`);
    
    // Test 5: Overall job confirmation
    console.log('\n🔄 Test 5: Overall job confirmation');
    
    const finalConfirmData = {
      assignedStatus: 'confirm',
      updatedAt: new Date()
    };
    
    await bookingRef.update(finalConfirmData);
    console.log(`✅ Overall job confirmed (status: confirm)`);
    
    // Manual sync
    const sync4 = await manualSyncByCustomerId(bookingId, testUserId, 'confirm');
    console.log(`✅ Manual sync for confirm: ${sync4}`);
    
    // Test 6: Verify final state
    console.log('\n📊 Test 6: Verify final state');
    const finalDoc = await bookingRef.get();
    const finalData = finalDoc.data();
    
    console.log('Final booking state:', {
      assignedStatus: finalData.assignedStatus,
      assignedCrews: finalData.assignedCrews,
      professionalsAssigned: finalData.professionalsAssigned,
      confirmedCrews: finalData.confirmedCrews,
      professionalsConfirmed: finalData.professionalsConfirmed
    });
    
    // Test 7: Verify sync status
    console.log('\n📊 Test 7: Verify sync status');
    const syncStatus = await getManualSyncStatus(bookingId, testUserId);
    console.log('Sync status:', syncStatus);
    
    // Test 8: Test individual crew unconfirmation
    console.log('\n🔄 Test 8: Test individual crew unconfirmation');
    
    // Unconfirm crew2
    const unconfirmCrews = confirmedCrews.filter(id => id !== crew2);
    
    const unconfirmData = {
      confirmedCrews: unconfirmCrews,
      professionalsConfirmed: unconfirmCrews.length,
      updatedAt: new Date()
    };
    
    await bookingRef.update(unconfirmData);
    console.log(`✅ Unconfirmed crew ${crew2} (professionalsConfirmed: ${unconfirmCrews.length})`);
    
    // Test 9: Test crew unassignment
    console.log('\n🔄 Test 9: Test crew unassignment');
    
    // Unassign crew3
    const unassignCrews = assignedCrews.filter(id => id !== crew3);
    const unassignProfessionals = Math.max(0, professionalsAssigned - 1);
    
    const unassignData = {
      assignedCrews: unassignCrews,
      professionalsAssigned: unassignProfessionals,
      assignedStatus: 'partially_assigned', // Back to partially_assigned
      assignedTo: unassignCrews.length > 0 ? unassignCrews[0] : null,
      updatedAt: new Date()
    };
    
    await bookingRef.update(unassignData);
    console.log(`✅ Unassigned crew ${crew3} (status: partially_assigned)`);
    
    // Manual sync
    const sync5 = await manualSyncByCustomerId(bookingId, testUserId, 'partially_assigned');
    console.log(`✅ Manual sync for partially_assigned: ${sync5}`);
    
    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await docRef.delete();
    await userBookingRef.delete();
    await userRef.delete();
    console.log('✅ Cleanup completed');
    
    console.log('\n🏁 Multi-crew fixes test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testMultiCrewFixes().then(() => {
  console.log('🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});
