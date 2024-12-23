const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const reportTypeModel = new Schema({
    report_name: {
        type: String,
    },
    violation_point: {
        type: Number,
    },
}, {
    timestamps: true, // Kích hoạt tính năng tự động tạo createdAt và updatedAt
});

module.exports = mongoose.model('reporttype', reportTypeModel);
