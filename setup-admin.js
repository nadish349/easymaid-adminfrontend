const { db } = require('./firebaseAdmin');

const ADMIN_COLLECTION = "adminonly";
const ADMIN_DOC_ID = "main";

async function setupAdminCredentials() {
  try {
    const docRef = db.collection(ADMIN_COLLECTION).doc(ADMIN_DOC_ID);
    
    // Set default admin credentials
    await docRef.set({
      email: "admin@homeclean.com",
      password: "admin123"
    });
    
    console.log('✅ Admin credentials set up successfully!');
    console.log('Email: admin@homeclean.com');
    console.log('Password: admin123');
    console.log('\nYou can now login to the admin panel with these credentials.');
    
  } catch (error) {
    console.error('❌ Error setting up admin credentials:', error);
  }
}

setupAdminCredentials(); 