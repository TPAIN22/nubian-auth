
import axios from 'axios';

const API_URL = 'http://localhost:5000/api/categories';

async function verifyFix() {
    console.log('Verifying Category Creation Fix...');
    
    try {
        const testCategory = {
            name: "Test Category " + Date.now(),
            description: "Testing parent empty string fix",
            parent: "" // This used to cause 500
        };

        console.log('Sending POST request with parent: ""...');
        const response = await axios.post(API_URL, testCategory);
        
        if (response.status === 201) {
            console.log('✅ Success! Category created successfully.');
            console.log('Created Category ID:', response.data._id);
            console.log('Parent value in DB:', response.data.parent);
            
            // Clean up: delete the test category
            const deleteUrl = `${API_URL}/${response.data._id}`;
            await axios.delete(deleteUrl);
            console.log('🗑️ Test category deleted.');
        } else {
            console.log('❌ Failed! Unexpected status code:', response.status);
        }
    } catch (error) {
        console.error('❌ Error testing category creation:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data));
        } else {
            console.error('Message:', error.message);
        }
    }
}

verifyFix();
