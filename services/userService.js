const Users = require("../models/userModel");
const status = require("../models/statusModel");
const Role = require("../models/roleModel");
const JWT = require('jsonwebtoken');
const HttpResponse = require("../utils/httpResponse");
const UtilsFunctions = require("../utils/utilsFunction");
const dotenv = require('dotenv');
const transporter = require("../config/common/mail");
const nodemailer = require("nodemailer");
const Friend = require("../models/friendModel");
const { sendOne } = require("../notification/Notification");
const mongoose = require('mongoose');
dotenv.config();
const SECRETKEY = process.env.SECRETKEY
const EMAIL = process.env.EMAIL

const removeVietnameseTones = (str) => {
    return str
        .normalize('NFD') // Chuẩn hóa Unicode
        .replace(/[\u0300-\u036f]/g, '') // Loại bỏ dấu
        .replace(/đ/g, 'd') // Chuyển đ -> d
        .replace(/Đ/g, 'D') // Chuyển Đ -> D
        .replace(/[^\w\s]/gi, '') // Loại bỏ ký tự đặc biệt
        .toLowerCase(); // Chuyển về chữ thường
};

class UserService {
    login = async (email, password) => {
        try {
            const user = await Users.findOne({ email, password }).populate('user_status_id').populate('role');
            if (user) {
                //Token người dùng sẽ sử dụng gửi lên trên header mỗi lần muốn gọi api
                const token = JWT.sign({ id: user._id }, SECRETKEY, { expiresIn: '1h' });
                //Khi token hết hạn, người dùng sẽ call 1 api khác để lấy token mới
                //Lúc này người dùng sẽ truyền refreshToken lên để nhận về 1 cặp token,refreshToken mới
                //Nếu cả 2 token đều hết hạn người dùng sẽ phải thoát app và đăng nhập lại
                const refreshToken = JWT.sign({ id: user._id }, SECRETKEY, { expiresIn: '1d' })
                //expiresIn thời gian token
                return HttpResponse.auth(user, token, refreshToken)
            } else {
                // Nếu thêm không thành công result null, thông báo không thành công
                return HttpResponse.fail(HttpResponse.getErrorMessages('loginFail'));
            }
        } catch (error) {
            console.log(error);
            return HttpResponse.error(error);
        }
    }
    // register = async (email, password, full_name, sex, role) => {
    //     try {
    //         const existing = await Users.findOne({
    //             email
    //         });
    //         // console.log(existingShowtime);
    //         if (existing) {
    //             return HttpResponse.fail(HttpResponse.getErrorMessages('registerEmailExists'));
    //         }
    //         const passwordEncryption = await UtilsFunctions.passwordEncryption(password);
    //         const newUser = new Users({
    //             email,
    //             password: password ?? passwordEncryption,
    //             full_name,
    //             sex,
    //             role
    //         });
    //         const result = await newUser.save();
    //         if (result) {
    //             return HttpResponse.success(result, HttpResponse.getErrorMessages('registerSuccess'));
    //         } else {
    //             return HttpResponse.fail(HttpResponse.getErrorMessages('registerFail'));
    //         }
    //     } catch (error) {
    //         console.log(error);
    //         return HttpResponse.error(error);
    //     }
    // }
    register = async (email, password, full_name, sex, role) => {
        try {
            // Kiểm tra xem email đã tồn tại chưa
            const existing = await Users.findOne({ email });
            if (existing) {
                return HttpResponse.fail(HttpResponse.getErrorMessages('registerEmailExists'));
            }

            // Mã hóa mật khẩu
            const passwordEncryption = await UtilsFunctions.passwordEncryption(password);

            // Tạo mã xác thực ngẫu nhiên
            const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

            // Tạo người dùng mới
            const newUser = new Users({
                email,
                password: passwordEncryption,
                full_name,
                sex,
                role,
                verificationCode, // Thêm mã xác thực vào cơ sở dữ liệu
                isVerified: false  // Giả sử có thêm cờ xác thực tài khoản
            });

            // Lưu người dùng vào cơ sở dữ liệu
            const result = await newUser.save();
            if (result) {
                // Cấu hình nội dung email xác nhận
                const mailOptions = {
                    from: {
                        name: 'CampusPoly',
                        address: process.env.EMAIL
                    },
                    to: email,
                    subject: 'Xác nhận đăng ký tài khoản',
                    html: `
                        <div style="white-space: pre-line;">
                            Xin chào <strong>${full_name}</strong>,

                            Cảm ơn bạn đã đăng ký tài khoản. Mã xác thực của bạn là: <strong>${verificationCode}</strong>.
                            Vui lòng nhập mã này để kích hoạt tài khoản của bạn.

                            Trân trọng!
                        </div>
                    `,
                };

                // Gửi email
                await transporter.sendMail(mailOptions);

                // Phản hồi thành công
                return HttpResponse.success({ result, verificationCode }, HttpResponse.getErrorMessages('registerSuccess'));
            } else {
                return HttpResponse.fail(HttpResponse.getErrorMessages('registerFail'));
            }
        } catch (error) {
            console.log(error);
            return HttpResponse.error(error);
        }
    }
    getAllUser = async (req, res) => {
        try {
            // Tìm tất cả người dùng và đính kèm thông tin về trạng thái và vai trò
            const users = await Users.find().populate('user_status_id', '-_id').populate('role');

            // Tạo một mảng để chứa thông tin người dùng và bạn bè của họ
            const usersWithFriends = await Promise.all(users.map(async (user) => {
                // Tìm danh sách bạn bè cho từng người dùng
                const friends = await Friend.find({ user_id: user._id })
                    .select('user_id status_id')  // Chọn trường user_id và status_id
                    .populate('status_id', 'status_name -_id') // Chỉ lấy trường status_name
                    .lean();  // Sử dụng lean() để tránh phải gọi toObject()

                // Lọc ra danh sách bạn bè có trạng thái là "Chấp nhận"
                const acceptedFriends = friends.filter(friend => friend.status_id.status_name === 'Chấp nhận')
                    .map(friend => {
                        // Lọc ra bạn bè không chứa user_id là người tìm
                        const otherFriend = friend.user_id.filter(id => id.toString() !== user._id.toString());
                        return otherFriend[0];  // Chỉ lấy user_id của bạn bè
                    });

                // Lấy thông tin chi tiết bạn bè
                const populatedFriends = await Promise.all(acceptedFriends.map(async (userId) => {
                    const friendDetails = await Users.findById(userId)
                        .select('full_name avatar'); // Lấy tên và avatar của người bạn
                    return {
                        _id: friendDetails._id,
                        full_name: friendDetails.full_name,
                        avatar: friendDetails.avatar,
                    };
                }));

                // Trả về thông tin người dùng kèm bạn bè
                return {
                    ...user.toObject(),  // Chuyển đối tượng mongoose thành đối tượng thuần
                    friends: populatedFriends,  // Thêm danh sách bạn bè vào đối tượng người dùng
                };
            }));

            // Kiểm tra nếu có dữ liệu người dùng
            if (usersWithFriends.length > 0) {
                return HttpResponse.success(usersWithFriends, HttpResponse.getErrorMessages('success'));
            } else {
                return HttpResponse.fail(HttpResponse.getErrorMessages('dataNotFound'));
            }
        } catch (error) {
            console.log(error);
            return HttpResponse.error(error);
        }
    };

    // getUserByPage = async (page, limit) => {
    //     try {
    //         const skip = (parseInt(page) - 1) * parseInt(limit);  // Tính số bản ghi cần bỏ qua (skip)

    //         // Tìm tất cả người dùng với phân trang
    //         const users = await Users.find()
    //             .skip(skip)  // Bỏ qua số lượng bản ghi
    //             .limit(parseInt(limit))  // Giới hạn số lượng bản ghi trả về
    //             .populate('user_status_id', '-_id')
    //             .populate('role');

    //         // Tính tổng số bản ghi để tính tổng số trang
    //         const totalUsers = await Users.countDocuments();
    //         const totalPages = Math.ceil(totalUsers / parseInt(limit));  // Tính tổng số trang

    //         // Tạo một mảng để chứa thông tin người dùng và bạn bè của họ
    //         const usersWithFriends = await Promise.all(users.map(async (user) => {
    //             // Tìm danh sách bạn bè cho từng người dùng
    //             const friends = await Friend.find({ user_id: user._id })
    //                 .select('user_id status_id')  // Chọn trường user_id và status_id
    //                 .populate('status_id', 'status_name -_id') // Chỉ lấy trường status_name
    //                 .lean();  // Sử dụng lean() để tránh phải gọi toObject()

    //             // Lọc ra danh sách bạn bè có trạng thái là "Chấp nhận"
    //             const acceptedFriends = friends.filter(friend => friend.status_id.status_name === 'Chấp nhận')
    //                 .map(friend => {
    //                     // Lọc ra bạn bè không chứa user_id là người tìm
    //                     const otherFriend = friend.user_id.filter(id => id.toString() !== user._id.toString());
    //                     return otherFriend[0];  // Chỉ lấy user_id của bạn bè
    //                 });

    //             // Lấy thông tin chi tiết bạn bè
    //             const populatedFriends = await Promise.all(acceptedFriends.map(async (userId) => {
    //                 const friendDetails = await Users.findById(userId)
    //                     .select('full_name avatar'); // Lấy tên và avatar của người bạn
    //                 return {
    //                     _id: friendDetails._id,
    //                     full_name: friendDetails.full_name,
    //                     avatar: friendDetails.avatar,
    //                 };
    //             }));

    //             // Trả về thông tin người dùng kèm bạn bè
    //             return {
    //                 ...user.toObject(),  // Chuyển đối tượng mongoose thành đối tượng thuần
    //                 friends: populatedFriends,  // Thêm danh sách bạn bè vào đối tượng người dùng
    //             };
    //         }));

    //         // Kiểm tra nếu có dữ liệu người dùng
    //         if (usersWithFriends.length > 0) {
    //             return HttpResponse.success({
    //                 users: usersWithFriends,  // Dữ liệu người dùng và bạn bè
    //                 totalPages,  // Tổng số trang
    //             }, HttpResponse.getErrorMessages('success'));
    //         } else {
    //             return HttpResponse.fail(HttpResponse.getErrorMessages('dataNotFound'));
    //         }
    //     } catch (error) {
    //         console.log(error);
    //         return HttpResponse.error(error);
    //     }
    // };
    getUserByPage = async (page, limit, roleId, status) => {
        try {
            const skip = (parseInt(page) - 1) * parseInt(limit); // Tính số bản ghi cần bỏ qua

            // Xây dựng query động
            const query = {};

            // Kiểm tra và tìm kiếm theo roleId
            if (roleId) {
                query.role = { _id: roleId }; // Tìm người dùng có _id trong mảng role tương ứng với roleId
            }

            if (status) query.user_status_id = status; // Lọc theo trạng thái
            console.log(query);

            // Tìm người dùng theo phân trang với điều kiện
            const users = await Users.find(query)
                .skip(skip)
                .limit(parseInt(limit))
                .populate('user_status_id')
                .populate('role'); // Nếu role là một ObjectId, cần populate để hiển thị tên

            // console.log("Users found:", users);

            // Tính tổng số bản ghi để tính tổng số trang
            const totalUsers = await Users.countDocuments(query);
            const totalPages = Math.ceil(totalUsers / parseInt(limit)); // Tính tổng số trang

            // Xử lý danh sách người dùng và bạn bè
            const usersWithFriends = await Promise.all(users.map(async (user) => {
                const friends = await Friend.find({ user_id: user._id })
                    .select('user_id status_id')
                    .populate('status_id', 'status_name -_id')
                    .lean();

                const acceptedFriends = friends.filter(friend => friend.status_id.status_name === 'Chấp nhận')
                    .map(friend => {
                        const otherFriend = friend.user_id.filter(id => id.toString() !== user._id.toString());
                        return otherFriend[0];
                    });

                const populatedFriends = await Promise.all(acceptedFriends.map(async (userId) => {
                    const friendDetails = await Users.findById(userId)
                        .select('full_name avatar');
                    return {
                        _id: friendDetails._id,
                        full_name: friendDetails.full_name,
                        avatar: friendDetails.avatar,
                    };
                }));

                return {
                    ...user.toObject(),
                    friends: populatedFriends,
                };
            }));

            if (usersWithFriends.length > 0) {
                return HttpResponse.success({
                    users: usersWithFriends,
                    totalPages,
                }, HttpResponse.getErrorMessages('success'));
            } else {
                return HttpResponse.fail(HttpResponse.getErrorMessages('dataNotFound'));
            }
        } catch (error) {
            console.log(error);
            return HttpResponse.error(error);
        }
    };


    getUserByID = async (id) => {
        try {
            const user = await Users.findById(id)
                .populate('user_status_id')
                .populate('role');

            if (!user) {
                return HttpResponse.fail(HttpResponse.getErrorMessages('dataNotFound'));
            }

            // Tìm danh sách bạn bè của người dùng, sử dụng lean() để tránh lỗi toObject
            const friends = await Friend.find({ user_id: { $in: [id] } })
                .select('user_id status_id')
                .populate('status_id', 'status_name -_id')
                .populate('user_id', '_id full_name avatar')
                .lean(); // Sử dụng lean() để không cần gọi toObject()

            // Lọc ra danh sách bạn bè có trạng thái là "Chấp nhận"
            // const acceptedFriends = friends.filter(friend => friend.status_id.status_name === 'Chấp nhận')
            //     .map(friend => {
            //         // Lọc ra bạn bè không chứa user_id là người tìm
            //         const otherFriend = friend.user_id.filter(user => user.toString() !== id.toString());
            //         return otherFriend[0];  // Chỉ lấy user_id của bạn bè
            //     });

            // // Lấy thông tin chi tiết bạn bè
            // const populatedFriends = await Promise.all(acceptedFriends.map(async (userId) => {
            //     const friendDetails = await Users.findById(userId)
            //         .select('full_name avatar'); // Lấy tên và avatar của người bạn
            //     return {
            //         _id: friendDetails._id,
            //         full_name: friendDetails.full_name,
            //         avatar: friendDetails.avatar,
            //     };
            // }));

            const userData = {
                ...user.toObject(),
                friends: friends, // Thêm danh sách bạn bè vào đối tượng người dùng
            };

            return HttpResponse.success(userData, HttpResponse.getErrorMessages('success'));
        } catch (error) {
            console.log(error);
            return HttpResponse.error(error);
        }
    }

    putUser = async (id, email, password, full_name, sex, role, user_status_id, avatar, background, bio, last_login, birthday, isVerified, block_reason, block_count) => {
        try {
            const newUpdate = await Users.findById(id);

            let result = null;
            if (newUpdate) {
                newUpdate.email = email ?? newUpdate.email,
                    newUpdate.password = password ?? newUpdate.password,
                    newUpdate.full_name = full_name ?? newUpdate.full_name,
                    newUpdate.sex = sex ?? newUpdate.sex,
                    newUpdate.role = role ?? newUpdate.role,
                    newUpdate.user_status_id = user_status_id ?? newUpdate.user_status_id,
                    newUpdate.avatar = !avatar ? newUpdate.avatar : avatar,
                    newUpdate.background = !background ? newUpdate.background : background,
                    newUpdate.bio = bio ?? newUpdate.bio,
                    newUpdate.last_login = last_login ?? newUpdate.last_login,
                    newUpdate.birthday = birthday ?? newUpdate.birthday,
                    newUpdate.isVerified = isVerified ?? newUpdate.isVerified;
                newUpdate.block_reason = block_reason ?? newUpdate.block_reason;
                newUpdate.block_count = block_count ?? newUpdate.block_count;

                result = await newUpdate.save();
                if (newUpdate.user_status_id == '67089ccb862f7badead53eba') {
                    sendOne(
                        'Chúng tôi đã chặn tài khoản của bạn',
                        `Bạn đã vi phạm quy định của chúng tôi. Vui lòng liên hệ với chúng tôi qua email ${EMAIL} để biết thêm chi tiết. `,
                        id,
                        '670ca3898cfc1be4b41b183b',
                        'admin_block_user',
                        ''
                    )
                }
            }
            if (result) {
                return HttpResponse.success(result, HttpResponse.getErrorMessages('success'));
            } else {
                return HttpResponse.fail(HttpResponse.getErrorMessages('dataNotFound'));
            }

        } catch (error) {
            console.log(error);
            return HttpResponse.error(error);
        }
    }
    deleteUser = async (id) => {
        try {
            const result = await Users.findByIdAndDelete(id);
            if (result) {
                return HttpResponse.success(result, HttpResponse.getErrorMessages('success'));
            } else {
                return HttpResponse.fail(HttpResponse.getErrorMessages('dataNotFound'));
            }
        } catch (error) {
            console.log(error);
            return HttpResponse.error(error);
        }
    }
    // loginWithGoogle = async (user) => {
    //     try {
    //         // Gọi Google People API để lấy thêm thông tin ngày sinh và giới tính
    //         const response = await fetch('https://people.googleapis.com/v1/people/me?personFields=genders,birthdays', {
    //             headers: {
    //                 Authorization: `Bearer ${user.accessToken}`, // Gửi accessToken
    //             },
    //         });
    //         const data = await response.json();
    //         const birthday = await data.birthdays;
    //         const gender = await data.genders;
    //         console.log(user);

    //         console.log('Ngày sinh:', birthday[0].date);
    //         console.log('Giới tính:', gender[0].value);
    //         console.log('Access Token:', user.accessToken);

    //         // Trả về thông tin người dùng
    //         const { accessToken, ...userWithoutToken } = user;

    //         let result;

    //         const existingUser = await Users.findOne({ email: user.email });
    //         if (existingUser) {
    //             result = await Users.findByIdAndUpdate(existingUser._id, {
    //                 // ...userWithoutToken,
    //                 // birthday: `${birthday[0].date.day}-${birthday[0].date.month}-${birthday[0].date.year}`,
    //                 // sex: gender[0].value,
    //                 ...existingUser,
    //                 last_login: Date.now()
    //             })
    //         } else {
    //             const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    //             const newUser = new Users({
    //                 ...userWithoutToken,
    //                 birthday: UtilsFunctions.convertStringToISODate(`${birthday[0].date.day}-${birthday[0].date.month}-${birthday[0].date.year}`),
    //                 sex: gender[0].value,
    //             });

    //             result = await newUser.save();
    //             // if (result) {
    //             //     const mailOptions = {
    //             //         from: {
    //             //             name: 'CampusPoly',
    //             //             address: process.env.EMAIL
    //             //         },
    //             //         to: user.email,
    //             //         subject: 'Xác nhận đăng ký tài khoản',
    //             //         html: `
    //             //             <div style="white-space: pre-line;">
    //             //                 Xin chào <strong>${user.full_name}</strong>,

    //             //                 Cảm ơn bạn đã đăng ký tài khoản. Mã xác thực của bạn là: <strong>${verificationCode}</strong>.
    //             //                 Vui lòng nhập mã này để kích hoạt tài khoản của bạn.

    //             //                 Trân trọng!
    //             //             </div>
    //             //         `,
    //             //     };

    //             //     // Gửi email
    //             //     await transporter.sendMail(mailOptions);

    //             //     result = {
    //             //         user: result,
    //             //         verificationCode
    //             //     }
    //             // }
    //         }
    //         // console.log(result);

    //         if (result) {
    //             return HttpResponse.success(result, HttpResponse.getErrorMessages('success'));
    //         } else {
    //             return HttpResponse.fail(HttpResponse.getErrorMessages('dataNotFound'));
    //         }
    //     } catch (error) {
    //         console.log(error);
    //         return HttpResponse.error(error);
    //     }
    // }
    loginWithGoogle = async (user) => {
        try {
            // console.log('user: ', user);
            // Gọi Google People API để lấy thêm thông tin ngày sinh và giới tính
            const response = await fetch('https://people.googleapis.com/v1/people/me?personFields=genders,birthdays', {
                headers: {
                    Authorization: `Bearer ${user.accessToken}`, // Gửi accessToken
                },
            });
            const data = await response.json();
            const birthdayData = data.birthdays;
            const genderData = data.genders;
            // console.log(data);

            // Kiểm tra và lấy ngày sinh
            let birthday;
            if (birthdayData && birthdayData[0] && birthdayData[0].date) {
                const { day, month, year } = birthdayData[0].date;
                birthday = new Date(year, month - 1, day); // Tháng - 1 vì Date của JS bắt đầu từ 0
            }

            const gender = genderData && genderData[0] && genderData[0].value !== 'unspecified' ? genderData[0].value : 'other';

            // console.log('Ngày sinh:', birthday);
            // console.log('Giới tính:', gender);
            // console.log('Access Token:', user.accessToken);

            const { accessToken, ...userWithoutToken } = user;
            let result;

            // Kiểm tra nếu người dùng đã tồn tại
            const existingUser = await Users.findOne({ email: user.email }).populate('user_status_id');

            if (existingUser) {
                result = await Users.findByIdAndUpdate(existingUser._id, {
                    ...existingUser.toObject(), // Chuyển đổi thành đối tượng thuần túy
                    last_login: Date.now(),
                    device_token: user.device_token,
                }, { new: true }); // Thêm tùy chọn { new: true } để trả về đối tượng đã cập nhật
            } else {
                const newUser = new Users({
                    ...userWithoutToken,
                    background: userWithoutToken.background || "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRWCNUmgIXmb9DdD1k4GURmooIHJ0j-YSRACQ&s",
                    avatar: userWithoutToken.avatar || "https://img.freepik.com/premium-vector/default-avatar-profile-icon-social-media-user-image-gray-avatar-icon-blank-profile-silhouette-vector-illustration_561158-3485.jpg",
                    birthday, // Sử dụng giá trị Date hợp lệ cho birthday
                    sex: gender,
                    device_token: user.device_token,
                });
                // console.log(newUser);


                result = await newUser.save();
            }

            // console.log(result);
            if (result.user_status_id.toString() === '67089ccb862f7badead53eba') {
                console.log('Người dùng bị chặn');
                return HttpResponse.fail('Bạn đã bị chặn');
            }

            if (result) {
                // await sendNotification('Chào mừng bạn đến với CampusPoly', 'Học tiếng anh đi! 😡', [result]);
                return HttpResponse.success(result, HttpResponse.getErrorMessages('success'));
            } else {
                return HttpResponse.fail(HttpResponse.getErrorMessages('dataNotFound'));
            }
        } catch (error) {
            console.log(error);
            return HttpResponse.error(error);
        }
    }
    getUserByName = async (searchTerm, page, limit) => {
        try {
            // Đảm bảo page và limit hợp lệ
            page = parseInt(page) || 1;
            limit = parseInt(limit) || 10;

            const skip = (page - 1) * limit;  // Tính số bản ghi cần bỏ qua (skip)

            // Chuẩn hóa từ khóa tìm kiếm (loại bỏ dấu tiếng Việt và khoảng trắng thừa)
            const normalizedSearchTerm = removeVietnameseTones(searchTerm || "").trim();
            console.log("Normalized Search Term:", normalizedSearchTerm);

            // Tìm người dùng có tên gần khớp với từ khóa tìm kiếm (bất kỳ vị trí nào trong chuỗi)
            const users = await Users.find({
                $or: [
                    { full_name: { $regex: normalizedSearchTerm, $options: 'i' } },  // Tìm kiếm không dấu
                    { full_name: { $regex: searchTerm, $options: 'i' } }  // Tìm kiếm có dấu
                ]
            })
                .skip(skip)  // Bỏ qua số lượng bản ghi
                .limit(limit)  // Giới hạn số lượng bản ghi trả về
                .populate('user_status_id', '-_id')  // Lấy thông tin trạng thái
                .populate('role');  // Lấy thông tin role

            // Tính tổng số bản ghi để tính tổng số trang
            const totalUsers = await Users.countDocuments({
                $or: [
                    { full_name: { $regex: normalizedSearchTerm, $options: 'i' } },  // Tính tổng số người dùng không dấu
                    { full_name: { $regex: searchTerm, $options: 'i' } }  // Tính tổng số người dùng có dấu
                ]
            });
            const totalPages = Math.ceil(totalUsers / limit);  // Tính tổng số trang

            // Tạo một mảng để chứa thông tin người dùng và bạn bè của họ
            const usersWithFriends = await Promise.all(users.map(async (user) => {
                // Tìm danh sách bạn bè cho từng người dùng
                const friends = await Friend.find({ user_id: user._id })
                    .select('user_id status_id')  // Chọn trường user_id và status_id
                    .populate('status_id', 'status_name -_id') // Chỉ lấy trường status_name
                    .lean();  // Sử dụng lean() để tránh phải gọi toObject()

                // Lọc ra danh sách bạn bè có trạng thái là "Chấp nhận"
                const acceptedFriends = friends.filter(friend => friend.status_id.status_name === 'Chấp nhận')
                    .map(friend => {
                        // Lọc ra bạn bè không chứa user_id là người tìm
                        const otherFriend = friend.user_id.filter(id => id.toString() !== user._id.toString());
                        return otherFriend[0];  // Chỉ lấy user_id của bạn bè
                    });

                // Lấy thông tin chi tiết bạn bè
                const populatedFriends = await Promise.all(acceptedFriends.map(async (userId) => {
                    const friendDetails = await Users.findById(userId)
                        .select('full_name avatar'); // Lấy tên và avatar của người bạn
                    return {
                        _id: friendDetails._id,
                        full_name: friendDetails.full_name,
                        avatar: friendDetails.avatar,
                    };
                }));

                // Trả về thông tin người dùng kèm bạn bè
                return {
                    ...user.toObject(),  // Chuyển đối tượng mongoose thành đối tượng thuần
                    friends: populatedFriends,  // Thêm danh sách bạn bè vào đối tượng người dùng
                };
            }));

            // Kiểm tra nếu có dữ liệu người dùng
            if (usersWithFriends.length > 0) {
                return HttpResponse.success({
                    users: usersWithFriends,  // Dữ liệu người dùng và bạn bè
                    totalPages,  // Tổng số trang
                }, HttpResponse.getErrorMessages('success'));
            } else {
                return HttpResponse.fail(HttpResponse.getErrorMessages('dataNotFound'));
            }
        } catch (error) {
            console.log(error);
            return HttpResponse.error(error);
        }
    };

    updateUserStatus = async (userId, reason = 'violation') => {
        try {
            // Tìm người dùng trước
            const user = await Users.findById(userId);
            if (!user) {
                console.error(`User with ID ${userId} not found.`);
                return false;
            }
            // Tăng giá trị block_count
            const updatedBlockCount = (user.block_count || 0) + 1;
            // Cập nhật trạng thái và thông tin block của người dùng
            const updatedUser = await Users.findByIdAndUpdate(
                userId,
                {
                    user_status_id: { _id: '67089ccb862f7badead53eba' }, // Trạng thái block
                    blocked_at: Date.now(), // Thời gian bị chặn
                    block_reason: reason, // Lý do bị chặn
                    block_count: updatedBlockCount, // Cập nhật số lần bị chặn
                },
                { new: true } // Trả về bản ghi đã được cập nhật
            );
            if (!updatedUser) {
                console.error(`Failed to update user with ID ${userId}.`);
                return false;
            }
            console.log(
                `User with ID ${userId} updated with new user_status_id, block reason, and block count (${updatedBlockCount}).`
            );
            return true;
        } catch (error) {
            console.error(`Error updating user status for user with ID ${userId}:`, error);
            throw new Error('Error updating user status.');
        }
    };

    checkAndUnblockUser = async (userId) => {
        // console.log(`Processing user with ID: ${userId}`);
        try {
            const user = await Users.findById(userId);
            if (!user) {
                console.error(`User with ID ${userId} not found.`);
                return false;
            }
            // console.log(`User details - is_blocked: ${user.user_status_id}, block_reason: ${user.block_reason}, blocked_at: ${user.blocked_at}`);
            // Chỉ mở khóa nếu lý do bị chặn là 'violation'
            if (
                user.user_status_id &&
                user.user_status_id.toString() === '67089ccb862f7badead53eba' &&
                user.block_reason === 'violation'
            ) {
                const currentDate = new Date();
                const blockDuration = currentDate - new Date(user.blocked_at); // Đảm bảo sử dụng new Date()
                const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000; // 7 ngày tính theo mili giây
                // console.log(`blockDuration: ${blockDuration}, Threshold: ${fiveSecondsInMs}`);
                if (blockDuration >= fiveSecondsInMs) {
                    user.blocked_at = null;
                    user.user_status_id = { _id: '67089cc2862f7badead53eb9' };

                    await user.save();
                    console.log(`User with ID ${userId} is now unblocked.`);
                    return true;
                }
            }
            // console.log(`User with ID ${userId} is not eligible for unblocking.`);
            return false;
        } catch (error) {
            console.error(`Error checking and unblocking user with ID ${userId}:`, error);
            throw new Error('Error checking and unblocking user.');
        }
    };




}


module.exports = UserService;