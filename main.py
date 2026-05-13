"""
PhotoVault — AI-Powered Photo Search

A Flask application that:
  1. Accepts photo uploads via a web interface
  2. Stores images in Google Cloud Storage
  3. Analyzes images with the Cloud Vision API (label detection)
  4. Saves detected labels to Cloud Firestore
  5. Provides a search API to find photos by label content
"""

import os
import uuid
from datetime import datetime

from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify

from google.cloud import storage as gcs
from google.cloud import vision
from google.cloud import firestore


load_dotenv()

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB 

GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "")
GCS_BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", "")

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

FIRESTORE_DATABASE_ID = os.environ.get("FIRESTORE_DATABASE_ID", "(default)")


_storage_client = None
_vision_client = None
_firestore_client = None

def get_storage_client():
    global _storage_client
    if _storage_client is None:
        _storage_client = gcs.Client(project=GCP_PROJECT_ID)
    return _storage_client

def get_vision_client():
    global _vision_client
    if _vision_client is None:
        _vision_client = vision.ImageAnnotatorClient()
    return _vision_client

def get_firestore_client():
    global _firestore_client
    if _firestore_client is None:
        _firestore_client = firestore.Client(project=GCP_PROJECT_ID, database=FIRESTORE_DATABASE_ID)
    return _firestore_client


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def analyze_image_labels(gcs_uri: str) -> list[dict]:
    client = get_vision_client()

    image = vision.Image()
    image.source = vision.ImageSource(image_uri=gcs_uri)

    response = client.label_detection(image=image)

    if response.error.message:
        raise Exception(f"Vision API error: {response.error.message}")

    labels = []
    for label in response.label_annotations:
        labels.append({
            "description": label.description,
            "score": round(label.score * 100),
        })

    return labels

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/upload", methods=["POST"])
def upload_photo():
    if "photo" not in request.files:
        return jsonify({"error": "No photo file provided"}), 400

    file = request.files["photo"]

    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed. Use JPG, PNG, or WebP."}), 400

    try:
        from werkzeug.utils import secure_filename
        
        # cloud storage upload
        original_name = secure_filename(file.filename)
        if not original_name or "." not in original_name:
            original_name = f"upload.png" # Safe fallback
            
        ext = original_name.rsplit(".", 1)[1].lower()
        blob_name = f"photos/{uuid.uuid4().hex}.{ext}"

        bucket = get_storage_client().bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(blob_name)
        blob.upload_from_file(file, content_type=file.content_type)

        # url construction
        public_url = f"https://storage.googleapis.com/{GCS_BUCKET_NAME}/{blob_name}"

        # vision api
        gcs_uri = f"gs://{GCS_BUCKET_NAME}/{blob_name}"
        labels_data = analyze_image_labels(gcs_uri)

        label_names = [l["description"] for l in labels_data]
        labels_lower = [l["description"].lower() for l in labels_data]
        scores = {l["description"]: l["score"] for l in labels_data}

        # store metadata in firestore
        doc_data = {
            "imageUrl": public_url,
            "storagePath": blob_name,
            "fileName": original_name,
            "labels": label_names,
            "labelsLower": labels_lower,
            "scores": scores,
            "createdAt": datetime.utcnow(),
        }

        doc_ref = get_firestore_client().collection("photos").add(doc_data)
        doc_data["id"] = doc_ref[1].id

        return jsonify({"success": True, "photo": doc_data}), 201

    except Exception as e:
        app.logger.error(f"Upload failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/photos", methods=["GET"])
def get_photos():
    try:
        photos_ref = get_firestore_client().collection("photos")
        query = photos_ref.order_by("createdAt", direction=firestore.Query.DESCENDING)
        docs = query.stream()

        photos = []
        for doc in docs:
            data = doc.to_dict()
            data["id"] = doc.id
            if "createdAt" in data and data["createdAt"]:
                data["createdAt"] = data["createdAt"].isoformat()
            photos.append(data)

        return jsonify(photos), 200

    except Exception as e:
        app.logger.error(f"Failed to fetch photos: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/search", methods=["GET"])
def search_photos():
    query_term = request.args.get("q", "").strip().lower()

    if not query_term:
        return jsonify({"error": "Query parameter 'q' is required"}), 400

    try:
        photos_ref = get_firestore_client().collection("photos")
        query = photos_ref.where("labelsLower", "array_contains", query_term)
        docs = query.stream()

        photos = []
        for doc in docs:
            data = doc.to_dict()
            data["id"] = doc.id
            if "createdAt" in data and data["createdAt"]:
                data["createdAt"] = data["createdAt"].isoformat()
            photos.append(data)

        photos.sort(key=lambda x: x.get("createdAt", ""), reverse=True)

        return jsonify(photos), 200

    except Exception as e:
        app.logger.error(f"Search failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/photos/<photo_id>", methods=["DELETE"])
def delete_photo(photo_id):
    try:
        db = get_firestore_client()
        doc_ref = db.collection("photos").document(photo_id)
        doc = doc_ref.get()

        if not doc.exists:
            return jsonify({"error": "Photo not found"}), 404

        data = doc.to_dict()

        if "storagePath" in data:
            bucket = get_storage_client().bucket(GCS_BUCKET_NAME)
            blob = bucket.blob(data["storagePath"])
            blob.delete()

        doc_ref.delete()

        return jsonify({"success": True}), 200

    except Exception as e:
        app.logger.error(f"Delete failed: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=True)
