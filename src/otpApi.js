// src/otpApi.js
// Helper functions to interact with the OTP backend.
// Uses the Firebase client SDK to obtain an ID token for authenticated requests.

import { auth } from "./firebase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * Get the current user's ID token.
 * Returns a promise that resolves to the token string, or null if no user.
 */
async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken();
}

export async function sendOtp() {
  const token = await getIdToken();
  if (!token) throw new Error("User not authenticated");
  const response = await fetch(`${API_BASE_URL}/api/otp/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to send OTP");
  return data;
}

export async function verifyOtp(otp) {
  const token = await getIdToken();
  if (!token) throw new Error("User not authenticated");
  const response = await fetch(`${API_BASE_URL}/api/otp/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ otp }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "OTP verification failed");
  return data;
}

export async function getOtpStatus() {
  const token = await getIdToken();
  if (!token) throw new Error("User not authenticated");
  const response = await fetch(`${API_BASE_URL}/api/otp/status`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to get OTP status");
  return data;
}
