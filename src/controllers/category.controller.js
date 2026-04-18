import Category from '../models/categories.model.js'
import { invalidateHomeCache } from './home.controller.js';

let categoriesCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const getCategories = async (req, res) => {
    try {
        if (categoriesCache && Date.now() - cacheTimestamp < CACHE_TTL) {
            return res.status(200).json(categoriesCache);
        }
        const categories = await Category.find().sort({ createdAt: -1 }).lean();
        categoriesCache = categories;
        cacheTimestamp = Date.now();
        res.status(200).json(categories)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
// مثال لـ getCategoryById
export const getCategoryById = async (req, res) => {
    try {
        const category = await Category.findById(req.params.id).lean();
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
        let { parent } = req.body;
        
        // التحقق من عدم وجود دوائر في العلاقات
        if (parent === "" || parent === "none") {
            parent = null;
            req.body.parent = null;
        }

        if (parent) {
            const parentCategory = await Category.findById(parent);
            if (!parentCategory) {
                return res.status(400).json({ message: 'الفئة الرئيسية غير موجودة' });
            }
        }
        
        const category = await Category.create(req.body)
        categoriesCache = null; // Invalidate categories cache
        invalidateHomeCache(); // Invalidate home cache
        res.status(201).json(category)
    } catch (error) {
        res.status(500).json({ message: error.message })
    }
}
export const updateCategory = async (req, res) => {
    
    try {
        let { name, description, image, isActive, parent } = req.body;
        
        // التحقق من عدم وجود دوائر في العلاقات
        if (parent === "" || parent === "none") {
            parent = null;
        }

        if (parent) {
            const parentCategory = await Category.findById(parent);
            if (!parentCategory) {
                return res.status(400).json({ message: 'الفئة الرئيسية غير موجودة' });
            }
            
            // التحقق من عدم جعل الفئة أباً لنفسها
            if (parent === req.params.id) {
                return res.status(400).json({ message: 'لا يمكن أن تكون الفئة أباً لنفسها' });
            }
        }
        
        // بناء updateData ديناميكياً - فقط الحقول الموجودة
        const updateData = {};
        
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (image !== undefined && image !== null) updateData.image = image;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (parent !== undefined) updateData.parent = parent; 
        
        // إضافة updatedAt
        updateData.updatedAt = Date.now();
        
        
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
        
        categoriesCache = null; // Invalidate categories cache
        invalidateHomeCache(); // Invalidate home cache
        res.status(200).json(category);
    } catch (error) {
        
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
        const categoryId = req.params.id;

        // التحقق مما إذا كانت هذه الفئة هي أب لفئات أخرى
        const subCategoryCount = await Category.countDocuments({ parent: categoryId });

        if (subCategoryCount > 0) {
            return res.status(400).json({ message: 'لا يمكن حذف هذه الفئة لأنها تحتوي على فئات فرعية. يرجى حذف الفئات الفرعية أولاً.' });
        }

        await Category.findByIdAndDelete(categoryId);
        categoriesCache = null; // Invalidate categories cache
        invalidateHomeCache(); // Invalidate home cache
        res.status(200).json({ message: 'تم حذف الفئة بنجاح' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
