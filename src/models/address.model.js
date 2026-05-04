import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    name: { type: String, trim: true, default: '', maxlength: 100 },

    countryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Country' },
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: 'City' },
    subCityId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubCity' },

    countryName: { type: String, trim: true, default: '', maxlength: 100 },
    cityName: { type: String, trim: true, default: '', maxlength: 100 },
    subCityName: { type: String, trim: true, default: '', maxlength: 100 },

    city: { type: String, trim: true, default: '', maxlength: 100 },
    area: { type: String, trim: true, default: '', maxlength: 100 },
    street: { type: String, trim: true, default: '', maxlength: 200 },
    building: { type: String, trim: true, default: '', maxlength: 100 },

    phone: { type: String, trim: true, default: '', maxlength: 30 },
    whatsapp: { type: String, trim: true, default: '', maxlength: 30 },

    notes: { type: String, trim: true, default: '', maxlength: 500 },

    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

addressSchema.index({ user: 1, isDefault: -1, updatedAt: -1 });

addressSchema.index(
  { user: 1, isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true },
  }
);

export default mongoose.model('Address', addressSchema);
