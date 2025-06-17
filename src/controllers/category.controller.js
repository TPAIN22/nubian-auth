import Category from '../models/categories.model.js'
export const getCategories = async (req, res) => {
    try {
        const categories = await Category.find().sort({ createdAt: -1 })
        res.status(200).json(categories)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
// مثال لـ getCategoryById
export const getCategoryById = async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ message: 'الفئة غير موجودة' });
        }
        res.status(200).json(category);
    } catch (error) {
        // تحقق إذا كان الخطأ بسبب معرف غير صالح
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'معرّف فئة غير صالح' });
        }
        res.status(500).json({ message: error.message });
    }
}
export const createCategory = async (req, res) => {
    try {
        const category = await Category.create(req.body)
        res.status(201).json(category)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const updateCategory = async (req, res) => {
    console.log('البيانات المستلمة:', req.body);
    
    try {
        const { name, description, image, isActive } = req.body;
        
        // بناء updateData ديناميكياً - فقط الحقول الموجودة
        const updateData = {};
        
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (image !== undefined && image !== null) updateData.image = image;
        if (isActive !== undefined) updateData.isActive = isActive;
        
        // إضافة updatedAt
        updateData.updatedAt = Date.now();
        
        console.log('البيانات التي سيتم تحديثها:', updateData);
        
        const category = await Category.findByIdAndUpdate(
            req.params.id, 
            updateData, 
            { 
                new: true,
                runValidators: true // تشغيل الـ validators
            }
        );
        
        if (!category) {
            return res.status(404).json({ message: 'الفئة غير موجودة' });
        }
        
        console.log('الفئة بعد التحديث:', category);
        
        res.status(200).json(category);
    } catch (error) {
        console.error('خطأ في تحديث الفئة:', error);
        
        // التعامل مع validation errors
        if (error.name === 'ValidationError') {
            return res.status(400).json({ 
                message: 'خطأ في التحقق من البيانات',
                details: error.errors 
            });
        }
        
        res.status(500).json({ message: error.message });
    }
};
export const deleteCategory = async (req, res) => {
    try {
        await Category.findByIdAndDelete(req.params.id)
        res.status(200).json({ message: 'Category deleted' })
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
