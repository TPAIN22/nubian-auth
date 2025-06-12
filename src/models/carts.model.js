import mongoose from "mongoose";

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  products: [
    {
      product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true,
      },
      quantity: {
        type: Number,
        required: true,
        default: 1,
        min: 1,
      },
      size: {
        type: String,
        default: '',
        required: false,
      },
    },
  ],
  totalQuantity: {
    type: Number,
    default: 0,
  },
  totalPrice: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// --- 🔥 أضف هذا الجزء الجديد هنا 🔥 ---
cartSchema.pre('save', async function(next) {
  // `this` يشير إلى مستند السلة الحالي الذي سيتم حفظه
  
  // نفّذ هذا المنطق فقط إذا تم تعديل مصفوفة المنتجات أو إذا كان المستند جديدًا
  if (this.isModified('products') || this.isNew) {
    // قم بتعبئة تفاصيل المنتج (مثل السعر) إذا لم تكن موجودة بالفعل
    // هذا يضمن أن `item.product` هو كائن المنتج بالكامل عند الحساب
    // `this.populate('products.product')` يعيد Promise، لذا نستخدم `await`
    await this.populate('products.product'); 

    let calculatedQuantity = 0;
    let calculatedPrice = 0;

    // المرور على كل عنصر في مصفوفة المنتجات وإعادة حساب الإجمالي
    this.products.forEach(item => {
      calculatedQuantity += item.quantity;
      // تأكد من أن `item.product` موجود (ليس null) وأن لديه خاصية `price`
      if (item.product && item.product.price) {
        calculatedPrice += item.quantity * item.product.price;
      }
    });

    // قم بتحديث قيم `totalQuantity` و `totalPrice` في مستند السلة
    this.totalQuantity = calculatedQuantity;
    this.totalPrice = calculatedPrice;
  }
  
  // انتقل إلى الخطوة التالية في عملية الحفظ
  next(); 
});
// --- 🔥 نهاية الجزء الجديد 🔥 ---


const Cart = mongoose.model("Cart", cartSchema);
export default Cart;