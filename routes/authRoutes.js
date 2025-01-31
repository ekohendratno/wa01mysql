const express = require('express');
const router = express.Router();

module.exports = (sessionManager) => {
    
    const redirectIfLoggedIn = (req, res, next) => {
        if (req.session.user) {
            return res.redirect('/device');
        }
        next();
    };

    router.get('/login', redirectIfLoggedIn, (req, res) => {
        res.render('auth/login', { error: null });
    });

    router.post('/login', async (req, res) => {
        try {
            const { username, password } = req.body;
            const user = await sessionManager.loginUser(username, password);
            
            req.session.user = user;
            res.redirect('/device');
        } catch (error) {
            res.render('auth/login', { 
                error: error.message || 'Login gagal' 
            });
        }
    });

    router.get('/register', redirectIfLoggedIn, (req, res) => {
        res.render('auth/register', { error: null });
    });

    router.post('/register', async (req, res) => {
        try {
            const { name, username, password } = req.body;
            const user = await sessionManager.registerUser(name, username, password);
            
            req.session.user = user;
            res.redirect('/device');
        } catch (error) {
            res.render('auth/register', { 
                error: error.message || 'Registrasi gagal' 
            });
        }
    });

    // Logout
    router.get('/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/auth/login');
    });

    

    return router;
};