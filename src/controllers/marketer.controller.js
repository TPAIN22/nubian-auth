import Marketer from '../models/marketer.model.js';
import Order from '../models/orders.model.js';
import { sendSuccess, sendCreated, sendError, sendNotFound } from '../lib/response.js';

// إضافة مسوّق جديد
export const createMarketer = async (req, res) => {
    try {
        const { name, code, commissionRate, discountRate } = req.body;

        // نتأكد الكود ما مكرر
        const existing = await Marketer.findOne({ code: code.toUpperCase() });
        if (existing) {
            return sendError(res, { message: 'Marketer code already exists', statusCode: 400 });
        }

        const marketer = await Marketer.create({
            name,
            code: code.toUpperCase(),
            commissionRate,
            discountRate
        });

        return sendCreated(res, marketer, 'Marketer created successfully');
    } catch (error) {
        return sendError(res, { message: error.message });
    }
};

// عرض كل المسوّقين
export const getMarketers = async (req, res) => {
    try {
        const marketers = await Marketer.find().sort({ createdAt: -1 });
        return sendSuccess(res, { data: marketers });
    } catch (error) {
        return sendError(res, { message: error.message });
    }
};

// عرض مسوّق واحد بالتفاصيل
export const getMarketerById = async (req, res) => {
    try {
        const marketer = await Marketer.findById(req.params.id);
        if (!marketer) {
            return sendNotFound(res, 'Marketer');
        }
        return sendSuccess(res, { data: marketer });
    } catch (error) {
        return sendError(res, { message: error.message });
    }
};

// تعديل بيانات المسوّق
export const updateMarketer = async (req, res) => {
    try {
        const { name, code, commissionRate, discountRate, status, phone } = req.body;

        const marketer = await Marketer.findById(req.params.id);
        if (!marketer) {
            return sendNotFound(res, 'Marketer');
        }

        marketer.name = name || marketer.name;
        marketer.code = code ? code.toUpperCase() : marketer.code;
        marketer.commissionRate = commissionRate ?? marketer.commissionRate;
        marketer.discountRate = discountRate ?? marketer.discountRate;
        marketer.status = status || marketer.status;
        marketer.phone = phone || marketer.phone;

        await marketer.save();
        return sendSuccess(res, { data: marketer, message: 'Marketer updated successfully' });
    } catch (error) {
        console.error('Update Marketer Error:', error);
        return sendError(res, { 
            message: error.message, 
            statusCode: error.name === 'MongoServerError' && error.code === 11000 ? 409 : (error.statusCode || 500) 
        });
    }
};

// حذف مسوّق
export const deleteMarketer = async (req, res) => {
    try {
        const marketer = await Marketer.findByIdAndDelete(req.params.id);
        if (!marketer) {
            return sendNotFound(res, 'Marketer');
        }
        return sendSuccess(res, { message: 'Marketer deleted successfully' });
    } catch (error) {
        return sendError(res, { message: error.message });
    }
};

export const getMarketerStats = async (req, res) => {
  try {
    const marketer = await Marketer.findById(req.params.id);
    if (!marketer) {
      return sendNotFound(res, 'Marketer');
    }

    const stats = await Order.aggregate([
      {
        $match: { marketerCode: marketer.code }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalEarnings: { $sum: "$marketerCommission" },
          totalSales: { $sum: "$finalAmount" }  
        }
      }
    ]);

    const orders = await Order.find({ marketerCode: marketer.code })
      .sort({ createdAt: -1 })
      .select("orderNumber totalAmount marketerCommission finalAmount createdAt");

    return sendSuccess(res, {
      data: {
        marketer,
        stats: stats[0] || { totalOrders: 0, totalEarnings: 0, totalSales: 0 },
        orders
      }
    });

  } catch (error) {
    return sendError(res, { message: error.message });
  }
};
