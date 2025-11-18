/**
 * Test script to verify booking mirroring functionality
 */

const { db } = require('./firebaseAdmin');
const { createMirroredBooking } = require('./utils/bookingSync');

async function testBookingMirror() {
  console.log('🧪 Testing booking mirroring...');
  
  try {
    // Test data
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
    
    // Create booking in main collection
    console.log('Creating booking in main collection...');
    const docRef = await db.collection('bookings').add(testBookingData);
    const bookingId = docRef.id;
    console.log(`✅ Created booking ${bookingId} in main collection`);
    
    // Test mirroring function
    console.log('Testing mirroring function...');
    const mirrorSuccess = await createMirroredBooking(bookingId, testBookingData.userId, testBookingData);
    
    if (mirrorSuccess) {
      console.log('✅ Mirroring function succeeded');
      
      // Verify the mirrored booking exists
      const userBookingRef = db.collection('users').doc(testBookingData.userId).collection('bookings').doc(bookingId);
      const userBookingDoc = await userBookingRef.get();
      
      if (userBookingDoc.exists) {
        console.log('✅ Mirrored booking verified in user subcollection');
        console.log('Mirrored booking data:', userBookingDoc.data());
      } else {
        console.log('❌ Mirrored booking not found in user subcollection');
      }
    } else {
      console.log('❌ Mirroring function failed');
    }
    
    // Cleanup
    console.log('Cleaning up test data...');
    await docRef.delete();
    await userBookingRef.delete();
    console.log('✅ Cleanup completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testBookingMirror().then(() => {
  console.log('🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});

