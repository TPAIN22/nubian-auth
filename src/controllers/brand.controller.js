import Brand from '../models/merchant.model.js'

// الحصول على كل العلامات التجارية
export const getmerchant = async (req, res) => {
    try {
        const merchant = await Brand.find()
        res.status(200).json(merchant)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}

// الحصول على علامة تجارية واحدة حسب الـ ID
export const getBrandById = async (req, res) => {   
    try {
        const brand = await Brand.findById(req.params.id)
        res.status(200).json(brand)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}

// إنشاء علامة تجارية جديدة (يجب أن يكون المستخدم مسجل دخوله)
export const createBrand = async (req, res) => {
    try {
        const brand = await Brand.create(req.body)
        res.status(201).json(brand)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}

// تحديث علامة تجارية موجودة (يجب أن يكون المستخدم مسجل دخوله)
export const updateBrand = async (req, res) => {
    try {
        const brand = await Brand.findByIdAndUpdate(req.params.id, req.body, { new: true })
        res.status(200).json(brand)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}

// حذف علامة تجارية (يجب أن يكون المستخدم مسجل دخوله ومسؤول)
export const deleteBrand = async (req, res) => {
    try {
        const brand = await Brand.findById(req.params.id);
        if (!brand) {
            return res.status(404).json({ message: 'Brand not found' });
        }

        await Brand.findByIdAndDelete(req.params.id)
        res.status(200).json({ message: 'Brand deleted' })
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
