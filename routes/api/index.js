var express = require('express');
var router = express.Router();

//====================== Khai báo ==========================//
// Routes
const userRoutes = require('./userRoutes');
const postRoutes = require('./postRoutes');
const reportRoutes = require('./reportRoutes');
const likeRoutes = require('./likeRoutes');
const commentRoutes = require('./commentRoutes');
const roleRoutes = require('./roleRoutes');
const groupRoutes = require('./groupRoutes');
const friendRoutes = require('./friendRoutes');
const reporttypeRoutes = require('./reportTypeRoutes');
//====================== Sử dụng ==========================//
//Routes
router.use('/users', userRoutes);
router.use('/posts', postRoutes);
router.use('/reports', reportRoutes);
router.use('/likes', likeRoutes);
router.use('/comments', commentRoutes);
router.use('/roles', roleRoutes);
router.use('/groups', groupRoutes);
router.use('/friends', friendRoutes);
router.use('/reporttypes', reporttypeRoutes);

module.exports = router;