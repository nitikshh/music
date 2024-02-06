const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const path = require('path');
const admin = require('firebase-admin');
const multer = require('multer');
const serviceAccount = require("./serviceAccountKey.json");

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://musify-d9098-default-rtdb.firebaseio.com",
    storageBucket: "musify-d9098.appspot.com" // Specify your storage bucket name here
});

// Initialize Firebase Realtime Database
const db = admin.database();
const songsRef = db.ref('bestsongs');

// Set up Multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Serve static files
app.use(express.static(path.join(__dirname, 'static')));

// Handle GET request to fetch uploaded songs
app.get('/songs', (req, res) => {
    songsRef.once('value', (snapshot) => {
        const songs = [];
        snapshot.forEach((childSnapshot) => {
            const song = childSnapshot.val();
            songs.push(song);
        });
        res.json(songs);
    }, (error) => {
        res.status(500).send('Error fetching songs from database: ' + error.message);
    });
});
// Handle DELETE request to delete a song
app.delete('/delete/:songName', async (req, res) => {
    const songName = req.params.songName;

    // First, delete the song entry from the database
    try {
        await songsRef.orderByChild('name').equalTo(songName).once('value', async (snapshot) => {
            snapshot.forEach(async (childSnapshot) => {
                const song = childSnapshot.val();
                const songId = childSnapshot.key;
                // Remove the song entry from the database
                await songsRef.child(songId).remove();
            });
        });
    } catch (error) {
        return res.status(500).send('Error deleting song from database: ' + error.message);
    }

    // Then, delete the corresponding file from storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(songName);

    try {
        await file.delete(); // Delete the file from storage
        res.sendStatus(200); // Send success response
    } catch (error) {
        return res.status(500).send('Error deleting song from storage: ' + error.message);
    }
});


// Handle song upload
app.post('/upload', upload.single('songFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    // Get form data
    const { songName, songWriter } = req.body;
    const fileData = req.file.buffer.toString('base64');
    const fileName = req.file.originalname;

    try {
        // Upload file to Firebase Storage
        const bucket = admin.storage().bucket();
        const file = bucket.file(fileName);
        const fileStream = file.createWriteStream({
            metadata: {
                contentType: req.file.mimetype,
            }
        });

        fileStream.on('error', (error) => {
            res.status(500).send('Error uploading file to storage: ' + error.message);
        });

        fileStream.on('finish', () => {
            // Get the download URL for the file
            file.getSignedUrl({
                action: 'read',
                expires: '03-09-2491', // Adjust expiration date as needed
            }, (err, songUrl) => {
                if (err) {
                    res.status(500).send('Error getting download URL: ' + err.message);
                } else {
                    // Save song details to Firebase Realtime Database
                    songsRef.push({ name: songName, writer: songWriter, url: songUrl }, (error) => {
                        if (error) {
                            res.status(500).send('Error saving song to database.');
                        } else {
                            res.status(200).send('Song uploaded successfully.');
                        }
                    });
                }
            });
        });

        fileStream.end(req.file.buffer);

    } catch (error) {
        res.status(500).send('Error uploading file to storage: ' + error.message);
    }
});

// Serve the index.html file for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'public', 'index.html'));
});


// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
