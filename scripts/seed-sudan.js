/**
 * Run with:  node scripts/seed-sudan.js
 *
 * Seeds Sudan as a Country, its 18 states as Cities, and their major
 * localities as SubCities.
 *
 * Safe to re-run: uses upsert keyed on (countryId, nameEn) and (cityId, nameEn).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

// ── Schemas (inline so the script is self-contained) ─────────────────────────
const countrySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, minlength: 2, maxlength: 3 },
    nameAr: { type: String, required: true, trim: true, maxlength: 100 },
    nameEn: { type: String, required: true, trim: true, maxlength: 100 },
    isActive: { type: Boolean, default: true },
    defaultCurrencyCode: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'USD' },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const citySchema = new mongoose.Schema(
  {
    countryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },
    nameAr: { type: String, required: true, trim: true, maxlength: 100 },
    nameEn: { type: String, required: true, trim: true, maxlength: 100 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const subCitySchema = new mongoose.Schema(
  {
    cityId: { type: mongoose.Schema.Types.ObjectId, ref: 'City', required: true },
    nameAr: { type: String, required: true, trim: true, maxlength: 100 },
    nameEn: { type: String, required: true, trim: true, maxlength: 100 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Country = mongoose.models.Country || mongoose.model('Country', countrySchema);
const City = mongoose.models.City || mongoose.model('City', citySchema);
const SubCity = mongoose.models.SubCity || mongoose.model('SubCity', subCitySchema);

// ── Country definition ───────────────────────────────────────────────────────
const COUNTRY = {
  code: 'SD',
  nameEn: 'Sudan',
  nameAr: 'السودان',
  defaultCurrencyCode: 'SDG',
  sortOrder: 0,
};

// ── States (cities) and their localities (subcities) ─────────────────────────
// Source: 18 administrative states (wilayat) of Sudan + major localities per state.
const STATES = [
  {
    nameEn: 'Khartoum', nameAr: 'الخرطوم', sortOrder: 1,
    localities: [
      { nameEn: 'Khartoum',        nameAr: 'الخرطوم' },
      { nameEn: 'Omdurman',        nameAr: 'أم درمان' },
      { nameEn: 'Khartoum North',  nameAr: 'الخرطوم بحري' },
      { nameEn: 'East Nile',       nameAr: 'شرق النيل' },
      { nameEn: 'Jebel Awliya',    nameAr: 'جبل أولياء' },
      { nameEn: 'Karari',          nameAr: 'كرري' },
      { nameEn: 'Umm Bada',        nameAr: 'أم بدة' },
    ],
  },
  {
    nameEn: 'Gezira', nameAr: 'الجزيرة', sortOrder: 2,
    localities: [
      { nameEn: 'Wad Madani',  nameAr: 'ود مدني' },
      { nameEn: 'Al Hasaheisa', nameAr: 'الحصاحيصا' },
      { nameEn: 'Rufaa',       nameAr: 'رفاعة' },
      { nameEn: 'Al Managil',  nameAr: 'المناقل' },
      { nameEn: 'Al Kamlin',   nameAr: 'الكاملين' },
      { nameEn: '24 Al Qurashi', nameAr: '24 القرشي' },
    ],
  },
  {
    nameEn: 'Sennar', nameAr: 'سنار', sortOrder: 3,
    localities: [
      { nameEn: 'Sennar',     nameAr: 'سنار' },
      { nameEn: 'Singa',      nameAr: 'سنجة' },
      { nameEn: 'Ad-Dindar',  nameAr: 'الدندر' },
      { nameEn: 'Sennar Dam', nameAr: 'خزان سنار' },
      { nameEn: 'Abu Hujar',  nameAr: 'أبو حجار' },
    ],
  },
  {
    nameEn: 'White Nile', nameAr: 'النيل الأبيض', sortOrder: 4,
    localities: [
      { nameEn: 'Rabak',     nameAr: 'ربك' },
      { nameEn: 'Kosti',     nameAr: 'كوستي' },
      { nameEn: 'Ad-Dueim',  nameAr: 'الدويم' },
      { nameEn: 'Geteina',   nameAr: 'الجبلين' },
      { nameEn: 'Tendelti',  nameAr: 'تندلتي' },
    ],
  },
  {
    nameEn: 'Blue Nile', nameAr: 'النيل الأزرق', sortOrder: 5,
    localities: [
      { nameEn: 'Ad-Damazin', nameAr: 'الدمازين' },
      { nameEn: 'Roseires',   nameAr: 'الروصيرص' },
      { nameEn: 'Geissan',    nameAr: 'قيسان' },
      { nameEn: 'Kurmuk',     nameAr: 'الكرمك' },
      { nameEn: 'Bau',        nameAr: 'باو' },
    ],
  },
  {
    nameEn: 'Northern', nameAr: 'الشمالية', sortOrder: 6,
    localities: [
      { nameEn: 'Dongola',     nameAr: 'دنقلا' },
      { nameEn: 'Karima',      nameAr: 'كريمة' },
      { nameEn: 'Merowe',      nameAr: 'مروي' },
      { nameEn: 'Wadi Halfa',  nameAr: 'وادي حلفا' },
      { nameEn: 'Delgo',       nameAr: 'دلقو' },
    ],
  },
  {
    nameEn: 'River Nile', nameAr: 'نهر النيل', sortOrder: 7,
    localities: [
      { nameEn: 'Ad-Damer',   nameAr: 'الدامر' },
      { nameEn: 'Atbara',     nameAr: 'عطبرة' },
      { nameEn: 'Berber',     nameAr: 'بربر' },
      { nameEn: 'Shendi',     nameAr: 'شندي' },
      { nameEn: 'Abu Hamad',  nameAr: 'أبو حمد' },
    ],
  },
  {
    nameEn: 'Red Sea', nameAr: 'البحر الأحمر', sortOrder: 8,
    localities: [
      { nameEn: 'Port Sudan', nameAr: 'بورتسودان' },
      { nameEn: 'Suakin',     nameAr: 'سواكن' },
      { nameEn: 'Tokar',      nameAr: 'طوكر' },
      { nameEn: 'Sinkat',     nameAr: 'سنكات' },
      { nameEn: 'Haya',       nameAr: 'هيا' },
      { nameEn: 'Halaib',     nameAr: 'حلايب' },
    ],
  },
  {
    nameEn: 'Kassala', nameAr: 'كسلا', sortOrder: 9,
    localities: [
      { nameEn: 'Kassala',         nameAr: 'كسلا' },
      { nameEn: 'New Halfa',       nameAr: 'حلفا الجديدة' },
      { nameEn: 'Aroma',           nameAr: 'أروما' },
      { nameEn: 'Hamashkoreib',    nameAr: 'همشكوريب' },
      { nameEn: 'Wad al-Hilaywu',  nameAr: 'ود الحليو' },
    ],
  },
  {
    nameEn: 'Gedaref', nameAr: 'القضارف', sortOrder: 10,
    localities: [
      { nameEn: 'Gedaref',     nameAr: 'القضارف' },
      { nameEn: 'Doka',        nameAr: 'الدوكة' },
      { nameEn: 'Galabat',     nameAr: 'القلابات' },
      { nameEn: 'Al-Fashaga',  nameAr: 'الفشقة' },
      { nameEn: 'Al-Rahad',    nameAr: 'الرهد' },
    ],
  },
  {
    nameEn: 'North Kordofan', nameAr: 'شمال كردفان', sortOrder: 11,
    localities: [
      { nameEn: 'El-Obeid',  nameAr: 'الأبيض' },
      { nameEn: 'Bara',      nameAr: 'بارا' },
      { nameEn: 'Sheikan',   nameAr: 'شيكان' },
      { nameEn: 'Um Rawaba', nameAr: 'أم روابة' },
      { nameEn: 'Soderi',    nameAr: 'سودري' },
    ],
  },
  {
    nameEn: 'South Kordofan', nameAr: 'جنوب كردفان', sortOrder: 12,
    localities: [
      { nameEn: 'Kadugli',         nameAr: 'كادقلي' },
      { nameEn: 'Dilling',         nameAr: 'الدلنج' },
      { nameEn: 'Talodi',          nameAr: 'تلودي' },
      { nameEn: 'Reif Ash-Shargi', nameAr: 'ريف الشرقي' },
      { nameEn: 'Abu Jubeiha',     nameAr: 'أبو جبيهة' },
    ],
  },
  {
    nameEn: 'West Kordofan', nameAr: 'غرب كردفان', sortOrder: 13,
    localities: [
      { nameEn: 'Al-Fula',   nameAr: 'الفولة' },
      { nameEn: 'En Nahud',  nameAr: 'النهود' },
      { nameEn: 'Babanusa',  nameAr: 'بابنوسة' },
      { nameEn: 'Lagawa',    nameAr: 'لقاوة' },
      { nameEn: 'Muglad',    nameAr: 'المجلد' },
    ],
  },
  {
    nameEn: 'North Darfur', nameAr: 'شمال دارفور', sortOrder: 14,
    localities: [
      { nameEn: 'El Fasher',   nameAr: 'الفاشر' },
      { nameEn: 'Kutum',       nameAr: 'كتم' },
      { nameEn: 'Mellit',      nameAr: 'مليط' },
      { nameEn: 'Kabkabiya',   nameAr: 'كبكابية' },
      { nameEn: 'Saraf Umra',  nameAr: 'سرف عمرة' },
    ],
  },
  {
    nameEn: 'South Darfur', nameAr: 'جنوب دارفور', sortOrder: 15,
    localities: [
      { nameEn: 'Nyala',  nameAr: 'نيالا' },
      { nameEn: 'Kas',    nameAr: 'كاس' },
      { nameEn: 'Buram',  nameAr: 'برام' },
      { nameEn: 'Tullus', nameAr: 'تلس' },
      { nameEn: 'Edd al-Fursan', nameAr: 'عد الفرسان' },
    ],
  },
  {
    nameEn: 'East Darfur', nameAr: 'شرق دارفور', sortOrder: 16,
    localities: [
      { nameEn: 'Ed Daein',     nameAr: 'الضعين' },
      { nameEn: 'Adila',        nameAr: 'عديلة' },
      { nameEn: 'Abu Karinka',  nameAr: 'أبو كارنكا' },
      { nameEn: 'Bahr el Arab', nameAr: 'بحر العرب' },
      { nameEn: 'Asalaya',      nameAr: 'أساليا' },
    ],
  },
  {
    nameEn: 'West Darfur', nameAr: 'غرب دارفور', sortOrder: 17,
    localities: [
      { nameEn: 'El Geneina', nameAr: 'الجنينة' },
      { nameEn: 'Habila',     nameAr: 'هبيلا' },
      { nameEn: 'Kulbus',     nameAr: 'كلبس' },
      { nameEn: 'Sirba',      nameAr: 'سربا' },
      { nameEn: 'Beida',      nameAr: 'بيضا' },
    ],
  },
  {
    nameEn: 'Central Darfur', nameAr: 'وسط دارفور', sortOrder: 18,
    localities: [
      { nameEn: 'Zalingei',    nameAr: 'زالنجي' },
      { nameEn: 'Wadi Saleh',  nameAr: 'وادي صالح' },
      { nameEn: 'Mukjar',      nameAr: 'مكجر' },
      { nameEn: 'Bindisi',     nameAr: 'بنديسي' },
      { nameEn: 'Garsila',     nameAr: 'قرسيلا' },
    ],
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Connecting to MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  // 1. Country
  const country = await Country.findOneAndUpdate(
    { code: COUNTRY.code },
    {
      $set: {
        nameEn: COUNTRY.nameEn,
        nameAr: COUNTRY.nameAr,
        defaultCurrencyCode: COUNTRY.defaultCurrencyCode,
        sortOrder: COUNTRY.sortOrder,
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log(`Country  ✓  ${country.nameEn} (${country.code})  _id=${country._id}\n`);

  // 2. Cities + 3. SubCities
  let citiesCreated = 0;
  let citiesUpdated = 0;
  let subCitiesCreated = 0;
  let subCitiesUpdated = 0;

  for (const state of STATES) {
    const cityBefore = await City.findOne({ countryId: country._id, nameEn: state.nameEn }).select('_id');
    const city = await City.findOneAndUpdate(
      { countryId: country._id, nameEn: state.nameEn },
      {
        $set: {
          countryId: country._id,
          nameEn: state.nameEn,
          nameAr: state.nameAr,
          sortOrder: state.sortOrder,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (cityBefore) {
      citiesUpdated++;
      console.log(`  ↻ City     ${state.nameEn}`);
    } else {
      citiesCreated++;
      console.log(`  ✓ City     ${state.nameEn}`);
    }

    let order = 1;
    for (const loc of state.localities) {
      const subBefore = await SubCity.findOne({ cityId: city._id, nameEn: loc.nameEn }).select('_id');
      await SubCity.findOneAndUpdate(
        { cityId: city._id, nameEn: loc.nameEn },
        {
          $set: {
            cityId: city._id,
            nameEn: loc.nameEn,
            nameAr: loc.nameAr,
            sortOrder: order,
            isActive: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (subBefore) subCitiesUpdated++;
      else subCitiesCreated++;

      order++;
    }
    console.log(`      ${state.localities.length} localities`);
  }

  console.log('');
  console.log(`Done.`);
  console.log(`  Country:    1 upserted`);
  console.log(`  Cities:     ${citiesCreated} created, ${citiesUpdated} updated`);
  console.log(`  SubCities:  ${subCitiesCreated} created, ${subCitiesUpdated} updated`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
