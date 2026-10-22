import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { auth } from './firebase';
import { sendOtp, verifyOtp, getOtpStatus } from './otpApi';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut, updateProfile } from 'firebase/auth';
import { useEffect, useState, createContext, useContext } from 'react';
import './index.css';

// Helper to mask email addresses (e.g., j***@example.com)
const maskEmail = (email) => {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  const masked = `${local[0]}${'*'.repeat(local.length - 2)}${local.slice(-1)}`;
  return `${masked}@${domain}`;
};

// Auth context
const AuthContext = createContext(null);
function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const value = { user, auth };
  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
}

// Protected route component
function ProtectedRoute({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  // If user is authenticated but email not verified, send them to OTP verification page
  if (!user.emailVerified) {
    return <Navigate to="/verify-email" replace />;
  }
  return children;
}

// Pages
function LandingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen space-y-4">
      <h1 className="text-4xl font-bold">OTP Verification App</h1>
      <p className="text-lg">Secure login with email verification.</p>
      <div className="space-x-4">
        <Link to="/register" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">Sign Up</Link>
        <Link to="/login" className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition">Log In</Link>
      </div>
    </div>
  );
}

function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    try {
      setLoading(true);
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      // Set display name
      await updateProfile(userCredential.user, { displayName: name });
      await sendOtp();
      navigate('/verify-email');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-4 border rounded shadow-md">
      <h2 className="text-2xl mb-4">Register</h2>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <input type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required className="w-full p-2 border rounded" />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full p-2 border rounded" />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full p-2 border rounded" />
        <input type="password" placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="w-full p-2 border rounded" />
        <button type="submit" disabled={loading} className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700 transition">
          {loading ? 'Registering...' : 'Register'}
        </button>
      </form>
      <p className="mt-4 text-sm">Already have an account? <Link to="/login" className="text-blue-600 hover:underline">Log In</Link></p>
    </div>
  );
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/dashboard';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, email, password);
      // Refresh user to get latest verification status
      const currentUser = auth.currentUser;
      if (currentUser) {
        await currentUser.reload();
        if (currentUser.emailVerified) {
          navigate('/dashboard');
        } else {
          navigate('/verify-email');
        }
      } else {
        navigate('/login');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!email) {
      setError('Enter email to reset password');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setError('Password reset email sent');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-4 border rounded shadow-md">
      <h2 className="text-2xl mb-4">Log In</h2>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full p-2 border rounded" />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full p-2 border rounded" />
        <button type="submit" disabled={loading} className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
          {loading ? 'Logging in...' : 'Log In'}
        </button>
      </form>
      <button onClick={handleReset} className="mt-2 text-sm text-indigo-600 hover:underline">Forgot password?</button>
      <p className="mt-4 text-sm">Don't have an account? <Link to="/register" className="text-blue-600 hover:underline">Sign Up</Link></p>
    </div>
  );
}

function VerifyEmailPage() {
  const { user } = useAuth();
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false); // verify button loading
  const [sending, setSending] = useState(false); // send OTP loading
  const [otpSent, setOtpSent] = useState(false); // flag if OTP already sent
  const [cooldown, setCooldown] = useState(0);
  const navigate = useNavigate();

  // NOTE: OTP is now sent only when the user clicks the "Send OTP" button.
  // The automatic send on component mount has been removed to make the button visible.
  // If you need to trigger a send on load in the future, re‑add a useEffect similar to the previous implementation.

  // Cooldown timer for resend button
  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (otp.length !== 6) {
      setError('OTP must be 6 digits');
      return;
    }
    try {
      setLoading(true);
      await verifyOtp(otp);
      // Reload Firebase user to get updated emailVerified status
      await user.reload();
      navigate('/dashboard');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!user) return;
    try {
      await sendOtp();
      setMessage('OTP resent');
      setCooldown(60);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10 p-4 border rounded shadow-md">
      <h2 className="text-2xl mb-4 text-center">Verify Your Email</h2>
      <p className="mb-2 text-center">Enter the 6‑digit code sent to <strong>{maskEmail(user?.email)}</strong></p>
      {error && <p className="text-red-600 mb-2 text-center">{error}</p>}
      {message && <p className="text-green-600 mb-2 text-center">{message}</p>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          maxLength={6}
          pattern="[0-9]{6}"
          placeholder="123456"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
          className="w-full p-2 border rounded text-center"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
        >
          {loading ? 'Verifying...' : 'Verify OTP'}
        </button>
      </form>
      {/* Conditional Send OTP / Resend OTP */}
      {!otpSent ? (
        <button
          onClick={async () => {
            setSending(true);
            try {
              await sendOtp();
              setMessage('OTP sent to your email');
              setOtpSent(true);
              setCooldown(60);
            } catch (e) {
              setError(e.message);
            } finally {
              setSending(false);
            }
          }}
          disabled={sending || cooldown > 0}
          className="mt-4 w-full py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
        >
          {sending ? 'Sending...' : 'Send OTP'}
        </button>
      ) : (
        <button
          onClick={handleResend}
          disabled={cooldown > 0}
          className="mt-4 w-full py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}
        </button>
      )}
      <div className="mt-4 text-center">
        <button onClick={() => navigate('/login')} className="text-sm text-blue-600 hover:underline">Back to Login</button>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const handleLogout = async () => {
    await signOut(auth);
    navigate('/');
  };
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6">
      {/* Header */}
      <header className="w-full max-w-4xl flex justify-between items-center mb-8 bg-indigo-100 p-4 rounded">
        <h1 className="text-3xl font-semibold text-indigo-800">OTP Verification</h1>
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
        >
          Logout
        </button>
      </header>

      {/* Profile Card */}
      <section className="w-full max-w-md bg-white rounded-xl shadow-lg p-6 space-y-4">
        <h2 className="text-2xl font-medium text-gray-800 mb-2">Welcome, {user?.displayName || 'User'}!</h2>
        <p className="text-gray-600"><strong>Name:</strong> {user?.displayName || 'N/A'}</p>
        <p className="text-gray-600"><strong>Email:</strong> {user?.email}</p>
        <div className="flex items-center space-x-2">
          <strong className="text-gray-600">Status:</strong>
          {user?.emailVerified ? (
            <span className="inline-flex items-center px-2 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Verified
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
              Unverified
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <h2 className="text-3xl">404 - Page Not Found</h2>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;








