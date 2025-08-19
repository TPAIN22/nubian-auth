import Marketer from '../models/marketer.model.js';
import Order from '../models/orders.model.js';

// إضافة مسوّق جديد
export const createMarketer = async (req, res) => {
    try {
        const { name, code, commissionRate, discountRate } = req.body;

        // نتأكد الكود ما مكرر
        const existing = await Marketer.findOne({ code: code.toUpperCase() });
        if (existing) {
            return res.status(400).json({ message: 'Marketer code already exists' });
        }

        const marketer = await Marketer.create({
            name,
            code: code.toUpperCase(),
            commissionRate,
            discountRate
        });

        res.status(201).json(marketer);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// عرض كل المسوّقين
export const getMarketers = async (req, res) => {
    try {
        const marketers = await Marketer.find().sort({ createdAt: -1 });
        res.status(200).json(marketers);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// عرض مسوّق واحد بالتفاصيل
export const getMarketerById = async (req, res) => {
    try {
        const marketer = await Marketer.findById(req.params.id);
        if (!marketer) {
            return res.status(404).json({ message: 'Marketer not found' });
        }
        res.status(200).json(marketer);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// تعديل بيانات المسوّق
export const updateMarketer = async (req, res) => {
    try {
        const { name, code, commissionRate, discountRate } = req.body;

        const marketer = await Marketer.findById(req.params.id);
        if (!marketer) {
            return res.status(404).json({ message: 'Marketer not found' });
        }

        marketer.name = name || marketer.name;
        marketer.code = code ? code.toUpperCase() : marketer.code;
        marketer.commissionRate = commissionRate ?? marketer.commissionRate;
        marketer.discountRate = discountRate ?? marketer.discountRate;

        await marketer.save();
        res.status(200).json(marketer);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// حذف مسوّق
export const deleteMarketer = async (req, res) => {
    try {
        const marketer = await Marketer.findByIdAndDelete(req.params.id);
        if (!marketer) {
            return res.status(404).json({ message: 'Marketer not found' });
        }
        res.status(200).json({ message: 'Marketer deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getMarketerStats = async (req, res) => {
  try {
    const marketer = await Marketer.findById(req.params.id);
    if (!marketer) {
      return res.status(404).json({ message: 'Marketer not found' });
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

    res.status(200).json({
      marketer,
      stats: stats[0] || { totalOrders: 0, totalEarnings: 0, totalSales: 0 },
      orders
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
