require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const app = express();

// ============================================
// DATABASE CONNECTION
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

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// ============================================
// MULTER SETUP
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

function isSellerOrAdmin(req, res, next) {
    const role = req.session.user?.role;
    if (role === 'admin' || role === 'seller') {
        return next();
    }
    res.status(403).send('Access denied. Sellers and Admins only.');
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
// ROUTES - HOME (Only shows APPROVED cars)
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
            WHERE c.status = 'approved'
            ORDER BY c.created_at DESC
        `;
        params = [userId];
    } else {
        sql = `
            SELECT c.*, 0 AS is_favorite
            FROM cars c
            WHERE c.status = 'approved'
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
    const { username, email, password, role } = req.body;
    const userRole = role || 'user';

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)';
        connection.query(sql, [username, email, hashedPassword, userRole], (error, results) => {
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
    const sql = `SELECT c.*, u.username 
                 FROM cars c 
                 LEFT JOIN users u ON c.user_id = u.user_id 
                 WHERE c.car_id = ? AND c.status = 'approved'`;

    connection.query(sql, [carId], (error, results) => {
        if (error || results.length === 0) {
            return res.send('Car not found or not approved');
        }
        res.render('carDetails', { car: results[0] });
    });
});

// ============================================
// ROUTES - BUY CAR (USER only)
// ============================================
app.post('/buy-car/:id', isAuthenticated, (req, res) => {
    const carId = req.params.id;
    const userId = req.session.user.user_id;
    const role = req.session.user.role;

    // Only users can buy (not sellers or admins)
    if (role !== 'user') {
        return res.status(403).send('Only users can buy cars.');
    }

    // Check if car exists and is approved
    const checkSql = 'SELECT * FROM cars WHERE car_id = ? AND status = "approved"';
    connection.query(checkSql, [carId], (error, results) => {
        if (error || results.length === 0) {
            return res.status(404).send('Car not found or not available for purchase');
        }

        // Update car status to 'sold'
        const updateSql = 'UPDATE cars SET status = "sold" WHERE car_id = ?';
        connection.query(updateSql, [carId], (error, results) => {
            if (error) {
                console.error('Error buying car:', error);
                return res.status(500).send('Error processing purchase');
            }
            res.redirect('/');
        });
    });
});

// ============================================
// ROUTES - SELL CAR (Sellers and Admins)
// ============================================
app.get('/sell-car', isAuthenticated, isSellerOrAdmin, (req, res) => {
    res.render('sellCar', { error: null });
});

app.post('/sell-car', isAuthenticated, isSellerOrAdmin, upload.single('image'), (req, res) => {
    const { name, make, model, year, color, price, description } = req.body;
    const userId = req.session.user.user_id;
    const role = req.session.user.role;
    let image = null;

    if (req.file) {
        image = req.file.filename;
    }

    // If admin, auto-approve; if seller, pending
    const status = role === 'admin' ? 'approved' : 'pending';

    const sql = `INSERT INTO cars (user_id, name, make, model, year, color, price, description, image, status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    connection.query(sql, [userId, name, make, model, year, color, price, description, image, status], (error, results) => {
        if (error) {
            console.error('Error:', error);
            return res.render('sellCar', { error: 'Error adding car for sale. Please try again.' });
        }

        if (role === 'admin') {
            res.redirect('/dashboard');
        } else {
            res.redirect('/dashboard');
        }
    });
});

// ============================================
// ROUTES - ADMIN APPROVE/REJECT CARS
// ============================================
app.get('/admin/pending-cars', isAuthenticated, isAdmin, (req, res) => {
    const sql = 'SELECT c.*, u.username FROM cars c JOIN users u ON c.user_id = u.user_id WHERE c.status = "pending" ORDER BY c.created_at DESC';
    connection.query(sql, (error, results) => {
        if (error) {
            console.error('Error:', error);
            return res.send('Error retrieving pending cars');
        }
        res.render('pendingCars', { cars: results });
    });
});

app.post('/admin/approve-car/:id', isAuthenticated, isAdmin, (req, res) => {
    const carId = req.params.id;
    const sql = 'UPDATE cars SET status = "approved" WHERE car_id = ?';
    connection.query(sql, [carId], (error, results) => {
        if (error) {
            console.error('Error:', error);
            return res.send('Error approving car');
        }
        res.redirect('/admin/pending-cars');
    });
});

app.post('/admin/reject-car/:id', isAuthenticated, isAdmin, (req, res) => {
    const carId = req.params.id;
    const sql = 'UPDATE cars SET status = "rejected" WHERE car_id = ?';
    connection.query(sql, [carId], (error, results) => {
        if (error) {
            console.error('Error:', error);
            return res.send('Error rejecting car');
        }
        res.redirect('/admin/pending-cars');
    });
});

// ============================================
// ROUTES - EDIT CAR (Owner or Admin)
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
// ROUTES - DELETE CAR (Owner or Admin)
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
// ROUTES - SEARCH
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
            WHERE c.status = 'approved'
        `;
        params.push(userId);
    } else {
        sql = `
            SELECT c.*, 0 AS is_favorite
            FROM cars c
            WHERE c.status = 'approved'
        `;
    }

    if (query) {
        sql += ` AND (c.name LIKE ? OR c.make LIKE ? OR c.model LIKE ?)`;
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
// ROUTES - FAVOURITES
// ============================================
app.post('/favorite/:id', isAuthenticated, (req, res) => {
    const carId = req.params.id;
    const userId = req.session.user.user_id;

    const sql = `INSERT IGNORE INTO favorites (user_id, car_id) VALUES (?, ?)`;
    connection.query(sql, [userId, carId], (error) => {
        if (error) {
            console.error('Error adding favourite:', error);
            return res.status(500).send('Error adding car to favourites');
        }
        res.redirect(req.get('referer') || '/');
    });
});

app.post('/favorite/remove/:id', isAuthenticated, (req, res) => {
    const carId = req.params.id;
    const userId = req.session.user.user_id;

    const sql = `DELETE FROM favorites WHERE user_id = ? AND car_id = ?`;
    connection.query(sql, [userId, carId], (error) => {
        if (error) {
            console.error('Error removing favourite:', error);
            return res.status(500).send('Error removing favourite');
        }
        res.redirect(req.get('referer') || '/favorites');
    });
});

app.get('/favorites', isAuthenticated, (req, res) => {
    const userId = req.session.user.user_id;

    const sql = `
        SELECT c.*, 1 AS is_favorite
        FROM cars c
        INNER JOIN favorites f ON c.car_id = f.car_id
        WHERE f.user_id = ? AND c.status = 'approved'
        ORDER BY f.created_at DESC
    `;

    connection.query(sql, [userId], (error, results) => {
        if (error) {
            console.error('Error retrieving favourites:', error);
            return res.status(500).send('Error retrieving favourite cars');
        }
        res.render('favorites', { cars: results });
    });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));