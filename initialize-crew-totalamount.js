const { db } = require('./firebaseAdmin');

/**
 * Initialize totalAmount field for all existing crews
 * This is a one-time script to add the totalAmount field to existing crews
 */
async function initializeCrewTotalAmount() {
  try {
    console.log('🔄 Initializing totalAmount for all crews...\n');
    
    // Get all crews
    const crewsSnapshot = await db.collection('crews').get();
    
    if (crewsSnapshot.empty) {
      console.log('No crews found in the database');
      return;
    }
    
    let updatedCount = 0;
    let skippedCount = 0;
    
    // Process each crew
    for (const doc of crewsSnapshot.docs) {
      const crewData = doc.data();
      const crewId = doc.id;
      
      // Check if totalAmount field already exists
      if (crewData.totalAmount !== undefined) {
        console.log(`⏭️  Crew ${crewData.name || crewId}: Already has totalAmount (${crewData.totalAmount})`);
        skippedCount++;
        continue;
      }
      
      // Initialize totalAmount to 0
      await db.collection('crews').doc(crewId).update({
        totalAmount: 0,
        updatedAt: new Date()
      });
      
      console.log(`✅ Crew ${crewData.name || crewId}: Initialized totalAmount to 0`);
      updatedCount++;
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   - Total crews: ${crewsSnapshot.size}`);
    console.log(`   - Updated: ${updatedCount}`);
    console.log(`   - Skipped (already had totalAmount): ${skippedCount}`);
    console.log('\n✅ Initialization complete!');
    
  } catch (error) {
    console.error('❌ Error initializing crew totalAmount:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
initializeCrewTotalAmount();
