require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const app = express();

// ============================================
// DATABASE CONNECTION (HARDCODED PASSWORD)
// ============================================
const connection = mysql.createConnection({
    host: 'c237-eaint-mysql.mysql.database.azure.com',
    user: 'c237_029',
    password: 'c237029@2026!',
    database: 'c237_029_teamjubs',
    ssl: {
        rejectUnauthorized: false
    }

});

connection.connect((err) => {
    if (err) {
        console.error('❌ Error connecting to MySQL:', err.message);
        return;
    }
    console.log('✅ Connected to MySQL database');
});

// ============================================
// MIDDLEWARE
// ============================================
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Session setup
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// ============================================
// MULTER SETUP (Image Upload)
// ============================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    }
    res.redirect('/login');
}

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send('Access denied. Admin only.');
}

function isOwnerOrAdmin(req, res, next) {
    const carId = req.params.id;
    const userId = req.session.user?.user_id;
    const role = req.session.user?.role;

    if (role === 'admin') {
        return next();
    }

    const sql = 'SELECT user_id FROM cars WHERE car_id = ?';
    connection.query(sql, [carId], (error, results) => {
        if (error || results.length === 0) {
            return res.status(404).send('Car not found');
        }
        if (results[0].user_id === userId) {
            return next();
        }
        res.status(403).send('You can only edit your own cars.');
    });
}

// ============================================
// MAKE USER AVAILABLE TO ALL VIEWS
// ============================================
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// ============================================
// ROUTES - HOME (FIXED V2)
// ============================================
app.get('/', (req, res) => {
    const userId = req.session.user?.user_id;

    let sql;
    let params = [];

    if (userId) {
        sql = `
            SELECT c.*,
            EXISTS (
                SELECT 1
                FROM favorites f
                WHERE f.car_id = c.car_id
                AND f.user_id = ?
            ) AS is_favorite
            FROM cars c
            ORDER BY c.created_at DESC
        `;

        params = [userId];
    } else {
        sql = `
            SELECT c.*, 0 AS is_favorite
            FROM cars c
            ORDER BY c.created_at DESC
        `;
    }

    connection.query(sql, params, (error, results) => {
        if (error) {
            console.error('Error:', error);
            return res.send('Error retrieving cars');
        }

        res.render('index', {
            cars: results,
            query: ''
        });
    });
});

// ============================================
// ROUTES - AUTHENTICATION
// ============================================
app.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO users (username, email, password) VALUES (?, ?, ?)';
        connection.query(sql, [username, email, hashedPassword], (error, results) => {
            if (error) {
                console.error('Error:', error);
                return res.render('register', { error: 'Username or email already exists.' });
            }
            res.redirect('/login');
        });
    } catch (error) {
        console.error('Error:', error);
        res.render('register', { error: 'Something went wrong.' });
    }
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    const sql = 'SELECT * FROM users WHERE username = ? OR email = ?';
    connection.query(sql, [username, username], async (error, results) => {
        if (error || results.length === 0) {
            return res.render('login', { error: 'Invalid username or password.' });
        }

        const user = results[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.render('login', { error: 'Invalid username or password.' });
        }

        req.session.user = {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            role: user.role
        };

        res.redirect('/');
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// ============================================
// ROUTES - DASHBOARD
// ============================================
app.get('/dashboard', isAuthenticated, (req, res) => {
    const userId = req.session.user.user_id;
    const role = req.session.user.role;

    let sql;
    let params = [];

    if (role === 'admin') {
        sql = 'SELECT * FROM cars ORDER BY created_at DESC';
    } else {
        sql = 'SELECT * FROM cars WHERE user_id = ? ORDER BY created_at DESC';
        params = [userId];
    }

    connection.query(sql, params, (error, results) => {
        if (error) {
            console.error('Error:', error);
            return res.send('Error retrieving cars');
        }
        res.render('dashboard', { cars: results });
    });
});

// ============================================
// ROUTES - CAR DETAILS
// ============================================
app.get('/car/:id', (req, res) => {
    const carId = req.params.id;

    const sql = `
        SELECT c.*, u.username
        FROM cars c
        LEFT JOIN users u
            ON c.user_id = u.user_id
        WHERE c.car_id = ?
            AND c.status IN ('approved', 'sold')
    `;

    connection.query(sql, [carId], (error, results) => {
        if (error) {
            console.error('Error retrieving car details:', error);
            return res.send('Error retrieving car details');
        }

        if (results.length === 0) {
            return res.send('Car not found or not approved');
        }

        res.render('carDetails', {
            car: results[0]
        });
    });
});

// ============================================
// ROUTES - ADD CAR
// ============================================
app.get('/add-car', isAuthenticated, (req, res) => {
    res.render('addCar', { error: null });
});

app.post('/add-car', isAuthenticated, upload.single('image'), (req, res) => {
    const { name, make, model, year, color, price, description } = req.body;
    const userId = req.session.user.user_id;
    let image = null;

    if (req.file) {
        image = req.file.filename;
    }

    const sql = `
    INSERT INTO cars
    (user_id, name, make, model, year, color, price, description, image, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
`;
    connection.query(sql, [userId, name, make, model, year, color, price, description, image], (error, results) => {
        if (error) {
            console.error('Error:', error);
            return res.render('addCar', { error: 'Error adding car. Please try again.' });
        }
        res.redirect('/dashboard');
    });
});

// ============================================
// ROUTES - EDIT CAR
// ============================================
app.get('/edit-car/:id', isAuthenticated, isOwnerOrAdmin, (req, res) => {
    const carId = req.params.id;
    const sql = 'SELECT * FROM cars WHERE car_id = ?';

    connection.query(sql, [carId], (error, results) => {
        if (error || results.length === 0) {
            return res.send('Car not found');
        }
        res.render('editCar', { car: results[0], error: null });
    });
});

app.post('/edit-car/:id', isAuthenticated, isOwnerOrAdmin, upload.single('image'), (req, res) => {
    const carId = req.params.id;
    const { name, make, model, year, color, price, description } = req.body;
    let image = req.body.currentImage;

    if (req.file) {
        image = req.file.filename;
    }

    const sql = `UPDATE cars 
                 SET name = ?, make = ?, model = ?, year = ?, color = ?, price = ?, description = ?, image = ? 
                 WHERE car_id = ?`;

    connection.query(sql, [name, make, model, year, color, price, description, image, carId], (error, results) => {
        if (error) {
            console.error('Error:', error);
            return res.render('editCar', { car: { car_id: carId, name, make, model, year, color, price, description, image }, error: 'Error updating car.' });
        }
        res.redirect('/dashboard');
    });
});

// ============================================
// ROUTES - DELETE CAR
// ============================================
app.get('/delete-car/:id', isAuthenticated, isOwnerOrAdmin, (req, res) => {
    const carId = req.params.id;

    const sql = 'DELETE FROM cars WHERE car_id = ?';
    connection.query(sql, [carId], (error, results) => {
        if (error) {
            console.error('Error:', error);
            return res.send('Error deleting car');
        }
        res.redirect('/dashboard');
    });
});

// ============================================
// ROUTES - SEARCH (FIXED V2)
// ============================================
app.get('/search', (req, res) => {
    const { query, make, year } = req.query;
    const userId = req.session.user?.user_id;

    let sql;
    let params = [];

    if (userId) {
        sql = `
            SELECT c.*,
            EXISTS (
                SELECT 1
                FROM favorites f
                WHERE f.car_id = c.car_id
                AND f.user_id = ?
            ) AS is_favorite
            FROM cars c
            WHERE 1 = 1
        `;

        params.push(userId);
    } else {
        sql = `
            SELECT c.*, 0 AS is_favorite
            FROM cars c
            WHERE 1 = 1
        `;
    }

    if (query) {
        sql += `
            AND (
                c.name LIKE ?
                OR c.make LIKE ?
                OR c.model LIKE ?
            )
        `;

        const searchValue = `%${query}%`;
        params.push(searchValue, searchValue, searchValue);
    }

    if (make) {
        sql += ' AND c.make = ?';
        params.push(make);
    }

    if (year) {
        sql += ' AND c.year = ?';
        params.push(year);
    }

    sql += ' ORDER BY c.created_at DESC';

    connection.query(sql, params, (error, results) => {
        if (error) {
            console.error('Search error:', error);
            return res.send('Error searching cars');
        }

        res.render('index', {
            cars: results,
            query: query || ''
        });
    });
});

// ============================================
// ROUTES - FAVOURITE CARS
// ============================================

// Add a car to favourites
app.post('/favorite/:id', isAuthenticated, (req, res) => {
    const carId = req.params.id;
    const userId = req.session.user.user_id;

    const sql = `
        INSERT IGNORE INTO favorites (user_id, car_id)
        VALUES (?, ?)
    `;

    connection.query(sql, [userId, carId], (error) => {
        if (error) {
            console.error('Error adding favourite:', error);
            return res.status(500).send('Error adding car to favourites');
        }

        // Return to previous page
        res.redirect(req.get('referer') || '/');
    });
});


// Remove a car from favourites
app.post('/favorite/remove/:id', isAuthenticated, (req, res) => {
    const carId = req.params.id;
    const userId = req.session.user.user_id;

    const sql = `
        DELETE FROM favorites
        WHERE user_id = ? AND car_id = ?
    `;

    connection.query(sql, [userId, carId], (error) => {
        if (error) {
            console.error('Error removing favourite:', error);
            return res.status(500).send('Error removing favourite');
        }

        res.redirect(req.get('referer') || '/favorites');
    });
});


// Display the user's favourite cars
app.get('/favorites', isAuthenticated, (req, res) => {
    const userId = req.session.user.user_id;

    const sql = `
        SELECT c.*, 1 AS is_favorite
        FROM cars c
        INNER JOIN favorites f
            ON c.car_id = f.car_id
        WHERE f.user_id = ?
        ORDER BY f.created_at DESC
    `;

    connection.query(sql, [userId], (error, results) => {
        if (error) {
            console.error('Error retrieving favourites:', error);
            return res.status(500).send('Error retrieving favourite cars');
        }

        res.render('favorites', {
            cars: results
        });
    });
});

// ============================================
// ADMIN - VIEW PENDING CARS
// ============================================
app.get('/admin/pending-cars', isAuthenticated, isAdmin, (req, res) => {
    const sql = `
        SELECT c.*, u.username
        FROM cars c
        LEFT JOIN users u
            ON c.user_id = u.user_id
        WHERE c.status = 'pending'
        ORDER BY c.created_at DESC
    `;

    connection.query(sql, (error, results) => {
        if (error) {
            console.error('Error retrieving pending cars:', error);
            return res.status(500).send('Error retrieving pending cars');
        }

        res.render('pendingCars', {
            cars: results
        });
    });
});


// ============================================
// ADMIN - APPROVE CAR
// ============================================
app.post('/admin/approve-car/:id', isAuthenticated, isAdmin, (req, res) => {
    const carId = req.params.id;

    const sql = `
        UPDATE cars
        SET status = 'approved'
        WHERE car_id = ?
    `;

    connection.query(sql, [carId], (error) => {
        if (error) {
            console.error('Error approving car:', error);
            return res.status(500).send('Error approving car');
        }

        res.redirect('/admin/pending-cars');
    });
});

// ============================================
// ADMIN - REJECT CAR
// ============================================
app.post('/admin/reject-car/:id', isAuthenticated, isAdmin, (req, res) => {
    const carId = req.params.id;

    const sql = `
        UPDATE cars
        SET status = 'rejected'
        WHERE car_id = ?
    `;

    connection.query(sql, [carId], (error) => {
        if (error) {
            console.error('Error rejecting car:', error);
            return res.status(500).send('Error rejecting car');
        }

        res.redirect('/admin/pending-cars');
    });
});

// ============================================
// BUY CAR PAGE
// ============================================
app.get('/buy-car/:id', isAuthenticated, (req, res) => {
    const carId = req.params.id;

    const sql = `
        SELECT c.*, u.username
        FROM cars c
        LEFT JOIN users u
            ON c.user_id = u.user_id
        WHERE c.car_id = ?
        AND c.status = 'approved'
    `;

    connection.query(sql, [carId], (error, results) => {
        if (error) {
            console.error('Error retrieving car:', error);
            return res.status(500).send('Error retrieving car');
        }

        if (results.length === 0) {
            return res.status(404).send('Car not found or not approved');
        }

        res.render('buyCar', {
            car: results[0]
        });
    });
});

// ============================================
// SUBMIT PURCHASE REQUEST
// ============================================
app.post('/buy-car/:id', isAuthenticated, (req, res) => {
    const carId = req.params.id;
    const buyerId = req.session.user.user_id;

    const {
        buyerName,
        buyerEmail,
        buyerPhone,
        message
    } = req.body;

    const sql = `
        INSERT INTO purchases
        (
            car_id,
            buyer_id,
            buyer_name,
            buyer_email,
            buyer_phone,
            message,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `;

    connection.query(
        sql,
        [
            carId,
            buyerId,
            buyerName,
            buyerEmail,
            buyerPhone,
            message
        ],
        (error) => {
            if (error) {
                console.error('Error submitting purchase:', error);
                return res.status(500).send(
                    'Error submitting purchase request'
                );
            }

            res.redirect(`/purchase-success/${carId}`);
        }
    );
});

app.get('/purchase-success/:id', isAuthenticated, (req, res) => {
    res.render('purchaseSuccess', {
        carId: req.params.id
    });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
