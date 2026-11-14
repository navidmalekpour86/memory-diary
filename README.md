# Our Memories / خاطرات ما

A private photo diary for two. Persian (Jalali calendar, right-to-left) by default, with an English switch.

- Memories with title, date, place type, place name, note, photo album and a map pin
- Timeline with place-type filters, a month calendar, and a map of everywhere you went
- Each of you scores a memory 1–5 stars on criteria that fit its place type (for example taste, hygiene, service for cafes); scores are shown side by side with averages, and the timeline can sort by best
- Both partners can add, edit and delete; nobody else can see anything
- Photos are shrunk to 2000px before upload to stay inside the free 1 GB storage

It is a plain static site (no build step). Supabase stores the data and photos; any static host serves the files.

## Setup (about 15 minutes)

1. **Supabase project.** Create a free account at supabase.com and a new project.
2. **Database.** Open *SQL Editor*, paste all of `schema.sql`, change the two example emails and names at the bottom to yours, and run it.
3. **Lock sign-ups.** *Authentication > Sign In / Providers > Email*: turn **off** "Allow new users to sign up".
4. **Create your two logins.** *Authentication > Users > Add user > Create new user*, with "Auto confirm" ticked, once for each of you (same emails as step 2).
5. **Connect the app.** *Project Settings > API*: copy the Project URL and the `anon` public key into `config.js`.
6. **Publish.** Push this folder to a GitHub repository and turn on *Settings > Pages > Deploy from branch (main, / root)*. Free GitHub Pages needs a public repository; that only exposes the code, never your photos or memories, which stay behind login.

## Privacy

- Every table and the photo bucket are protected by row-level security that only allows the emails in `members`.
- The photo bucket is private; photos load through links that expire after one hour.
- The `anon` key in `config.js` is designed to be public; it gives no access without logging in.

## Notes

- Libraries (Supabase, Leaflet maps, Vazirmatn font) are bundled in `vendor/`, so the app does not depend on CDNs.
- The date field uses the phone's own (Gregorian) date picker; the Jalali date is shown right under it.
- To add a place type, add it to `PLACE_ICONS`, `CRITERIA` and both `places` lists in `strings.js`. To change score criteria, edit `CRITERIA` and both `crit` lists.
