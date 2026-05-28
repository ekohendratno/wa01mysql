const moment = require('moment');

exports.isValidPhoneNumber = (number) => {
    const phoneRegex = /^[0-9]{10,15}$/;
    return phoneRegex.test(number);
};

exports.isValidGroupId = (groupId) => {
    const groupIdRegex = /^[0-9]{18}@g\.us$/;
    return groupIdRegex.test(groupId);
};

exports.calculateLastActive = (updatedAt) => {
    const now = moment();
    const lastActiveTime = moment(updatedAt);
    const duration = moment.duration(now.diff(lastActiveTime));

    if (duration.asMinutes() < 1) {
        return 'Baru saja';
    } else if (duration.asHours() < 1) {
        return `${Math.floor(duration.asMinutes())} menit yang lalu`;
    } else if (duration.asDays() < 1) {
        return `${Math.floor(duration.asHours())} jam yang lalu`;
    } else {
        return `${Math.floor(duration.asDays())} hari yang lalu`;
    }
}

function getValidSessionRole(req) {
    const role = req && req.session && req.session.user && req.session.user.role;
    return role === 'admin' || role === 'client' ? role : null;
}

function clearInvalidSession(req, res, callback) {
    if (!req.session) return callback();

    delete req.session.user;
    if (typeof req.session.destroy === 'function') {
        return req.session.destroy(() => {
            res.clearCookie('wapi.sid');
            callback();
        });
    }

    callback();
}

exports.authMiddleware = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }

    if (!getValidSessionRole(req)) {
        return clearInvalidSession(req, res, () => res.redirect('/auth/login'));
    }

    next();
};


exports.redirectIfLoggedIn = (req, res, next) => {
    if (req.session.user) {
        const role = getValidSessionRole(req);
        if (!role) {
            return clearInvalidSession(req, res, next);
        }
        return res.redirect(`/${role}`);
    }
    next();
};

exports.requireRole = (role) => {
    return function (req, res, next) {
        if (!req.session.user) {
            return res.redirect('/auth/login');
        }

        const sessionRole = getValidSessionRole(req);
        if (!sessionRole) {
            return clearInvalidSession(req, res, () => res.redirect('/auth/login'));
        }

        if (sessionRole !== role) {
            return res.redirect(`/${sessionRole}`);
        }

        next();
    };
};
