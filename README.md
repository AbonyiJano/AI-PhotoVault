# 📸 PhotoVault — AI-Powered Photo Search

PhotoVault is a web app where you upload photos and then **search them by what's actually in them** — type "dog", "mountain", or "receipt" and get back every matching image. There are no manual tags: every photo is automatically analyzed by Google's Vision AI the moment it's uploaded.

This is a cloud-computing project built to learn how to wire together **three Google Cloud services** behind a single Flask app: object storage, a managed AI vision model, and a NoSQL database.

---

## ✨ What it does

- **Upload** photos via drag-and-drop (JPG, PNG, WebP, up to 10 MB).
- **Auto-tagging** — every image is sent to the Cloud Vision API, which returns content labels (e.g. *Dog, Animal, Grass*) with confidence scores.
- **Search** — find photos by label using a full-text-style content search.
- **Gallery** — browse all uploads, click any photo for a lightbox view with its detected labels.
- **Delete** — removes both the stored image and its database record.

---

## 🛠️ Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, [Flask](https://flask.palletsprojects.com/) |
| Frontend | Vanilla HTML / CSS / JavaScript (no framework) |
| File storage | **Google Cloud Storage** — holds the actual image files |
| AI / labeling | **Google Cloud Vision API** — label detection |
| Database | **Google Cloud Firestore** — stores photo metadata & labels |
| Serving | Gunicorn |
| Deployment | Docker → Google Cloud Run |

Dependencies are pinned in [requirements.txt](requirements.txt).

---

## 🔍 How it works

### Upload flow
When you upload a photo, the backend ([main.py](main.py)) runs a small pipeline:

```
   Browser
     │  (1) POST /api/upload  (multipart image)
     ▼
   Flask
     │  (2) upload file ───────────────► Cloud Storage  (gs://bucket/photos/<uuid>.jpg)
     │  (3) analyze image ─────────────► Vision API     → ["Dog", "Animal", ...]
     │  (4) save metadata ─────────────► Firestore      (url, labels, scores, timestamp)
     ▼
   Browser  ◄── (5) JSON response with the new photo
```

1. The image is given a unique name (`uuid`) and uploaded to a **Cloud Storage** bucket.
2. The stored image's `gs://` URI is passed to the **Vision API**, which returns content labels.
3. The labels (plus a lowercase copy for searching), confidence scores, image URL, and timestamp are written to a **Firestore** document.
4. The new photo is returned to the browser and appears in the gallery.

### Search flow
Labels are stored twice — once for display and once lowercased in a `labelsLower` array. Search uses Firestore's `array_contains` query against that array, so `"DOG"`, `"dog"`, and `"Dog"` all match the same photos.

### API endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/` | Serve the web UI |
| `POST` | `/api/upload` | Upload + analyze + store a photo |
| `GET` | `/api/photos` | List all photos (newest first) |
| `GET` | `/api/search?q=<term>` | Search photos by label |
| `DELETE` | `/api/photos/<id>` | Delete a photo (file + record) |

---

## 🚀 Running locally

### Prerequisites
- Python 3.11+
- A Google Cloud project with **Cloud Storage**, **Vision API**, and **Firestore** enabled
- A Cloud Storage bucket
- A service-account key with access to those services

### Setup

```bash
# 1. Clone and enter the project
cd cloudprog

# 2. Create a virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux

# 3. Install dependencies
pip install -r requirements.txt

# 4. Authenticate with Google Cloud
#    Point this at your service-account JSON key:
set GOOGLE_APPLICATION_CREDENTIALS=path\to\key.json   # Windows
# export GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json
```

### Configuration

Create a `.env` file in the project root:

```env
GCP_PROJECT_ID=your-project-id
GCS_BUCKET_NAME=your-bucket-name
FIRESTORE_DATABASE_ID=(default)
```

### Run

```bash
python main.py
```

Then open **http://localhost:8080**.

> ℹ️ For the public image URLs to display, the Cloud Storage bucket (or the uploaded objects) must be readable.

---

## ☁️ Deployment

The included [Dockerfile](Dockerfile) builds a container that serves the app with Gunicorn on port 8080 — ready for **Google Cloud Run**:

```bash
gcloud run deploy photovault --source . \
  --set-env-vars GCP_PROJECT_ID=your-project-id,GCS_BUCKET_NAME=your-bucket-name
```

On Cloud Run, authentication is handled automatically by the service's identity, so no key file is needed.

---

## 📁 Project structure

```
cloudprog/
├── main.py              # Flask backend — routes + GCP integration
├── requirements.txt     # Python dependencies
├── Dockerfile           # Container build for Cloud Run
├── templates/
│   └── index.html       # Single-page UI
└── static/
    ├── style.css        # Styling
    └── app.js           # Frontend logic (fetch calls to the API)
```

---

## 📚 What I learned

- **Composing cloud services** — splitting one feature across Storage (files), Vision (AI), and Firestore (data) instead of doing everything in one place.
- **Calling a managed AI API** — passing a `gs://` URI to the Vision API and turning its label response into something searchable.
- **Designing for search** — storing a lowercased `labelsLower` array so Firestore's `array_contains` gives case-insensitive matching.
- **Lazy client initialization** — creating GCP clients once and reusing them, so each request doesn't pay the setup cost.
- **Containerizing a Python web app** and serving it with Gunicorn for deployment to Cloud Run.
- **Keeping config out of code** — using environment variables / `.env` for project IDs, buckets, and credentials.
