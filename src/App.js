import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Define a context for Firebase and user data
const AppContext = createContext(null);

// Custom hook to use the app context
const useAppContext = () => useContext(AppContext);

// --- Firebase Configuration and Initialization ---
// For deployment, Firebase config will be loaded from environment variables
// These variables will be set in your deployment platform (e.g., Netlify, Vercel)
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

// The App ID for Firestore paths will also come from an environment variable,
// typically this can be the same as your Firebase Project ID.
const appIdentifier = process.env.REACT_APP_FIRESTORE_APP_ID || firebaseConfig.projectId || 'default-app-id';

// Variable para verificar si la configuración de Firebase es completa
const isFirebaseConfigComplete = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

// Initialize Gemini API Key
const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY;

// --- Main App Component ---
function App() { // Added 'function' keyword for App component
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newArtifactName, setNewArtifactName] = useState('');
  const [newArtifactContent, setNewArtifactContent] = useState('');
  const [selectedArtifact, setSelectedArtifact] = useState(null);
  const [selectedArtifactContent, setSelectedArtifactContent] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [dataForChart, setDataForChart] = useState([]);
  const [editingArtifact, setEditingArtifact] = useState(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const promptRef = useRef(null);


  let db;
  let auth;

  // Initialize Firebase App
  if (isFirebaseConfigComplete) {
    try {
      const firebaseApp = initializeApp(firebaseConfig); // CORRECTO: 'f' minúscula
      db = getFirestore(firebaseApp);
      auth = getAuth(firebaseApp);
      console.log("Firebase initialized successfully with environment variables.");
    } catch (error) {
      console.error("Error initializing Firebase with environment variables:", error);
      setError("Failed to initialize Firebase. Please check your environment variables.");
    }
  } else {
    console.warn("Firebase configuration is incomplete. App functionality will be limited.");
    setError("Firebase configuration is missing. App functionality will be limited.");
    // Eliminada la lógica de fallback de '__firebase_config' que causaba el error
    // y no es necesaria para el despliegue en Vercel.
  }

  useEffect(() => {
    if (auth) { // Only set up auth listener if auth is initialized
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          if (currentUser.email === 'admin@admin.com') { // Example admin check
            setIsAdmin(true);
          } else {
            setIsAdmin(false);
          }
        } else {
          setUser(null);
          setIsAdmin(false);
        }
        setLoading(false);
      });
      return () => unsubscribe();
    } else {
      setLoading(false); // If auth couldn't initialize, stop loading state
    }
  }, [auth]);

  useEffect(() => {
    if (!user && auth) { // Only attempt anonymous sign-in if no user and auth is initialized
      signInAnonymously(auth)
        .then(() => {
          console.log("Signed in anonymously");
        })
        .catch((err) => {
          console.error("Anonymous sign-in failed", err);
          setError("Anonymous sign-in failed. Some features may not work.");
        });
    }
  }, [user, auth]); // Depend on user and auth

  useEffect(() => {
    if (db && user) { // Only fetch if db and user are initialized
      const publicDataCollectionRef = collection(db, "artifacts", appIdentifier, "public", "data");
      const unsubscribe = onSnapshot(publicDataCollectionRef, (snapshot) => {
        const newArtifacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setArtifacts(newArtifacts);

        // Prepare data for chart
        const categoryCounts = {};
        newArtifacts.forEach(artifact => {
          if (artifact.category) {
            categoryCounts[artifact.category] = (categoryCounts[artifact.category] || 0) + 1;
          }
        });
        setDataForChart(Object.keys(categoryCounts).map(category => ({
          name: category,
          value: categoryCounts[category]
        })));
      }, (err) => {
        console.error("Error fetching artifacts:", err);
        setError("Failed to fetch artifacts. Please check your connection.");
      });
      return () => unsubscribe();
    }
  }, [db, user, appIdentifier]); // Depend on db, user, and appIdentifier

  const handleAddArtifact = async () => {
    if (!newArtifactName.trim() || !newArtifactContent.trim()) {
      alert('Please enter both name and content for the new artifact.');
      return;
    }
    setLoading(true);
    try {
      const publicDataCollectionRef = collection(db, "artifacts", appIdentifier, "public", "data");
      await addDoc(publicDataCollectionRef, {
        name: newArtifactName.trim(), // Trim added
        content: newArtifactContent.trim(), // Trim added
        createdAt: new Date().toISOString(),
        createdBy: user?.uid || 'anonymous',
        category: 'Uncategorized' // Default category
      });
      setNewArtifactName('');
      setNewArtifactContent('');
    } catch (e) {
      console.error("Error adding document: ", e);
      setError("Failed to add artifact.");
    } finally {
      setLoading(false);
    }
  };

  const handleEditArtifact = (artifact) => {
    setEditingArtifact(artifact);
    setSelectedArtifactContent(artifact.content);
  };

  const handleSaveArtifact = async () => {
    if (!editingArtifact) return;
    setLoading(true);
    try {
      // Corrected usage of `collection` and `doc` for updating
      const docRef = doc(db, "artifacts", appIdentifier, "public", "data", editingArtifact.id);
      await setDoc(docRef, { // Use setDoc with merge:true for update
        content: selectedArtifactContent.trim(), // Trim added
        updatedAt: new Date().toISOString(),
        updatedBy: user?.uid || 'anonymous'
      }, { merge: true }); // Use merge:true to update fields without overwriting the entire document
      setEditingArtifact(null);
      setSelectedArtifact(null); // Clear selection after editing
      setSelectedArtifactContent('');
    } catch (e) {
      console.error("Error updating document: ", e);
      setError("Failed to update artifact.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteArtifact = async (id) => {
    if (!window.confirm('Are you sure you want to delete this artifact?')) {
      return;
    }
    setLoading(true);
    try {
      // Corrected usage of `collection` and `doc` for deleting
      const docRef = doc(db, "artifacts", appIdentifier, "public", "data", id);
      await deleteDoc(docRef); // Use doc(collectionRef, id) for document reference
    } catch (e) {
      console.error("Error deleting document: ", e);
      setError("Failed to delete artifact.");
    } finally {
      setLoading(false);
    }
  };

  const generateAIAugmentations = async () => {
    if (!selectedArtifactContent.trim() || !GEMINI_API_KEY) {
      alert("Please select an artifact and ensure Gemini API Key is set.");
      return;
    }

    setAiLoading(true);
    setAiSuggestions([]);

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate 3 creative augmentations or elaborations for the following text, focusing on different perspectives or expansions of the concept:\n\n"${selectedArtifactContent}"` }] }],
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.candidates && data.candidates.length > 0) {
        const generatedText = data.candidates[0].content.parts[0].text;
        const suggestionsArray = generatedText.split('\n\n').map(s => s.trim()).filter(s => s.length > 0);
        setAiSuggestions(suggestionsArray);
      } else {
        setAiSuggestions(["No suggestions generated."]);
      }
    } catch (error) {
      console.error("Error generating AI augmentations:", error);
      setError("Failed to generate AI suggestions.");
      setAiSuggestions(["Error generating suggestions."]);
    } finally {
      setAiLoading(false);
    }
  };

  const handlePromptSubmit = async () => {
    const userPrompt = promptRef.current.value.trim();
    if (!userPrompt || !GEMINI_API_KEY) {
        alert("Please enter a prompt and ensure Gemini API Key is set.");
        return;
    }

    setAiLoading(false); // Set to false initially, will set to true once prompt starts
    setAiSuggestions([]);
    setLastPrompt(userPrompt);

    // Prepare prompt to include selected artifact content if available
    let fullPrompt = userPrompt;
    if (selectedArtifactContent) {
        fullPrompt = `Regarding the selected artifact content "${selectedArtifactContent}", please respond to the following request: ${userPrompt}`;
    }

    setAiLoading(true); // Set to true here after preliminary checks

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }],
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.candidates && data.candidates.length > 0) {
            const generatedText = data.candidates[0].content.parts[0].text;
            setAiSuggestions([generatedText]); // Display single response for user prompt
        } else {
            setAiSuggestions(["No response generated."]);
        }
    } catch (error) {
        console.error("Error from AI prompt:", error);
        setError("Failed to get AI response.");
        setAiSuggestions(["Error getting AI response."]);
    } finally {
        setAiLoading(false);
    }
};


  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', fontSize: '24px' }}>
        Cargando aplicación...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'red', fontSize: '18px' }}>
        Error: {error}
        <br />
        Por favor, revisa tus configuraciones de Firebase y tu conexión a internet.
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ user, isAdmin, db, auth, appIdentifier, GEMINI_API_KEY }}>
      <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: '1200px', margin: '20px auto', padding: '20px', border: '1px solid #ddd', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h1 style={{ textAlign: 'center', color: '#333' }}>Área DEMO 360 - SUDS Madrid</h1>

        {/* Sección de autenticación */}
        <div style={{ marginBottom: '20px', padding: '15px', background: '#f9f9f9', borderRadius: '5px' }}>
          <h2 style={{ color: '#555' }}>Estado de Autenticación</h2>
          {user ? (
            <p>Conectado como: {user.isAnonymous ? 'Usuario Anónimo' : user.email}</p>
          ) : (
            <p>No conectado.</p>
          )}
          {isAdmin && <p style={{ fontWeight: 'bold', color: 'green' }}>Eres Administrador.</p>}
        </div>

        {/* Sección de añadir artefacto (Solo Admin) */}
        {isAdmin && (
          <div style={{ marginBottom: '30px', padding: '20px', background: '#e6ffe6', borderRadius: '8px', border: '1px solid #aaffaa' }}>
            <h2 style={{ color: '#4CAF50' }}>Añadir Nuevo Artefacto</h2>
            <input
              type="text"
              placeholder="Nombre del artefacto"
              value={newArtifactName}
              onChange={(e) => setNewArtifactName(e.target.value)}
              style={{ width: 'calc(100% - 22px)', padding: '10px', marginBottom: '10px', border: '1px solid #ccc', borderRadius: '4px' }}
            />
            <textarea
              placeholder="Contenido del artefacto"
              value={newArtifactContent}
              onChange={(e) => setNewArtifactContent(e.target.value)}
              rows="5"
              style={{ width: 'calc(100% - 22px)', padding: '10px', marginBottom: '10px', border: '1px solid #ccc', borderRadius: '4px' }}
            ></textarea>
            <button
              onClick={handleAddArtifact}
              style={{ padding: '10px 15px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
            >
              Añadir Artefacto
            </button>
          </div>
        )}

        {/* Sección de lista de artefactos */}
        <div style={{ marginBottom: '30px' }}>
          <h2 style={{ color: '#555' }}>Artefactos Existentes</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {artifacts.map((artifact) => (
              <li key={artifact.id} style={{ padding: '10px', border: '1px solid #eee', marginBottom: '8px', borderRadius: '4px', background: selectedArtifact?.id === artifact.id ? '#e0f7fa' : 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  onClick={() => {
                    setSelectedArtifact(artifact);
                    setSelectedArtifactContent(artifact.content);
                    setEditingArtifact(null); // Exit edit mode
                  }}
                  style={{ cursor: 'pointer', flexGrow: 1, color: '#007BFF' }}
                >
                  {artifact.name}
                </span>
                {isAdmin && (
                  <div>
                    <button
                      onClick={() => handleEditArtifact(artifact)}
                      style={{ padding: '5px 10px', background: '#FFC107', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', marginRight: '5px' }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteArtifact(artifact.id)}
                      style={{ padding: '5px 10px', background: '#DC3545', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Detalles y Edición de Artefacto Seleccionado */}
        {selectedArtifact && (
          <div style={{ marginBottom: '30px', padding: '20px', background: '#f0f8ff', borderRadius: '8px', border: '1px solid #b3e5fc' }}>
            <h2 style={{ color: '#007BFF' }}>Detalles del Artefacto: {selectedArtifact.name}</h2>
            {editingArtifact ? (
              <div>
                <textarea
                  value={selectedArtifactContent}
                  onChange={(e) => setSelectedArtifactContent(e.target.value)}
                  rows="10"
                  style={{ width: 'calc(100% - 22px)', padding: '10px', marginBottom: '10px', border: '1px solid #ccc', borderRadius: '4px' }}
                ></textarea>
                <button
                  onClick={handleSaveArtifact}
                  style={{ padding: '10px 15px', background: '#28A745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', marginRight: '10px' }}
                >
                  Guardar Cambios
                </button>
                <button
                  onClick={() => {
                    setEditingArtifact(null);
                    setSelectedArtifactContent(selectedArtifact.content); // Revert changes
                  }}
                  style={{ padding: '10px 15px', background: '#6C757D', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                >
                  Cancelar Edición
                </button>
              </div>
            ) : (
              <p style={{ whiteSpace: 'pre-wrap' }}>{selectedArtifactContent}</p>
            )}

            {/* Sección de Interacción con IA */}
            <div style={{ marginTop: '20px', padding: '15px', background: '#fff3cd', borderRadius: '8px', border: '1px solid #ffeeba' }}>
              <h3 style={{ color: '#FFC107' }}>Asistente de IA (Gemini)</h3>
              <button
                onClick={generateAIAugmentations}
                disabled={aiLoading}
                style={{ padding: '10px 15px', background: '#FFC107', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', marginBottom: '10px' }}
              >
                {aiLoading ? 'Generando...' : 'Generar Aumentos de IA'}
              </button>
              <div style={{ display: 'flex', marginTop: '10px' }}>
                <input
                    type="text"
                    ref={promptRef}
                    placeholder="Pregúntale algo a la IA sobre el artefacto..."
                    style={{ flexGrow: 1, padding: '10px', border: '1px solid #ccc', borderRadius: '4px', marginRight: '10px' }}
                />
                <button
                    onClick={handlePromptSubmit}
                    disabled={aiLoading}
                    style={{ padding: '10px 15px', background: '#17A2B8', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                >
                    {aiLoading ? 'Enviando...' : 'Enviar Prompt'}
                </button>
            </div>
              {aiSuggestions.length > 0 && (
                <div style={{ marginTop: '15px', padding: '10px', background: '#e9ecef', borderRadius: '5px', border: '1px solid #ced4da' }}>
                  <h4 style={{ color: '#6C757D' }}>Sugerencias de IA:</h4>
                  {aiSuggestions.map((suggestion, index) => (
                    <p key={index} style={{ marginBottom: '5px', whiteSpace: 'pre-wrap' }}>- {suggestion}</p>
                  ))}
                  {lastPrompt && <p style={{ fontWeight: 'bold', marginTop: '10px' }}>Último prompt enviado: "{lastPrompt}"</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Gráfico de categorías */}
        <div style={{ marginTop: '30px', padding: '20px', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h2 style={{ color: '#555', textAlign: 'center' }}>Distribución de Artefactos por Categoría</h2>
          {dataForChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dataForChart} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p style={{ textAlign: 'center' }}>No hay datos para mostrar el gráfico.</p>
          )}
        </div>
      </div>
    </AppContext.Provider>
  );
}

// --- Tab 1: Tipos de SUDS ---
const SudsTypesTab = () => {
  const { db, userId, userRole, appId, showCustomModal, handleMoveSudsType } = useAppContext(); // appId here is now appIdentifier
  const [sudsTypes, setSudsTypes] = useState([]);
  const [newSudsName, setNewSudsName] = useState('');
  const [newSudsDescription, setNewSudsDescription] = useState('');
  const [newSudsImageUrl, setNewSudsImageUrl] = useState('');
  const [newSudsLocationTypes, setNewSudsLocationTypes] = useState([]);
  const [editingSudsId, setEditingSudsId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddSudsForm, setShowAddSudsForm] = useState(false);
  const [filterLocationTypes, setFilterLocationTypes] = useState([]);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const canEdit = true; // Simplified: all users can edit

  const locationTypeOptions = [
    { id: 'acera', name: 'Acera', icon: '🚶‍♀️' },
    { id: 'zona_verde', name: 'Zona Verde', icon: '🌳' },
    { id: 'viario', name: 'Viario', icon: '🚗' },
    { id: 'infraestructura', name: 'Infraestructura', icon: 'https://img.freepik.com/vector-premium/icono-tuberia-fontanero-vector-simple-servicio-agua-tubo-aguas-residuales_98396-55465.jpg' },
  ];

  useEffect(() => {
    if (!db || !appId) { // appId here is appIdentifier from context
      setLoading(false);
      return;
    }

    const q = collection(db, `artifacts/${appId}/public/data/sudsTypes`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const types = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSudsTypes(types);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching SUDS types:", error);
      showCustomModal(`Error al cargar tipos de SUDS: ${error.message}`);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, appId, showCustomModal]);

  const handleToggleLocationType = (typeId) => {
    setNewSudsLocationTypes(prev =>
      prev.includes(typeId) ? prev.filter(id => id !== typeId) : [...prev, typeId]
    );
  };

  const handleToggleFilterLocationType = (typeId) => {
    setFilterLocationTypes(prev =>
      prev.includes(typeId) ? prev.filter(id => id !== typeId) : [...prev, typeId]
    );
  };

  const handleGenerateSudsDescription = async () => {
    if (!newSudsName.trim()) {
      showCustomModal("Por favor, introduce el nombre del SUDS para generar una descripción.");
      return;
    }

    setGeneratingDescription(true);
    try {
      const locationNames = newSudsLocationTypes.map(id => locationTypeOptions.find(opt => opt.id === id)?.name).filter(Boolean);
      const locationPrompt = locationNames.length > 0 ? `Si los tipos de ubicación son: ${locationNames.join(', ')}.` : '';
      const prompt = `Genera una descripción detallada para un SUDS llamado "${newSudsName.trim()}". ${locationPrompt} Enfócate en su función, beneficios y características principales en el contexto de Madrid. La descripción debe ser concisa y profesional, de unas 3-5 frases.`;

      let chatHistory = [];
      chatHistory.push({ role: "user", parts: [{ text: prompt }] });
      const payload = { contents: chatHistory };
      const apiKey = GEMINI_API_KEY; // Use directly from global const
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`; // Model updated to gemini-2.0-flash if needed, previously was gemini-pro

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        setNewSudsDescription(text);
      } else {
        showCustomModal("No se pudo generar la descripción. Inténtalo de nuevo.");
      }
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      showCustomModal(`Error al generar descripción: ${error.message}`);
    } finally {
      setGeneratingDescription(false);
    }
  };

  const handleAddOrUpdateSuds = async () => {
    if (!db) {
      showCustomModal("La base de datos no está disponible.");
      return;
    }
    if (!newSudsName.trim() || !newSudsDescription.trim()) {
      showCustomModal("Por favor, rellena el nombre y la descripción del SUDS.");
      return;
    }

    try {
      const sudsData = {
        name: newSudsName.trim(),
        description: newSudsDescription.trim(),
        imageUrls: newSudsImageUrl.trim() ? [newSudsImageUrl.trim()] : [],
        locationTypes: newSudsLocationTypes,
        lastUpdatedBy: userId,
        timestamp: new Date(),
      };

      if (editingSudsId) {
        await updateDoc(doc(db, `artifacts/${appId}/public/data/sudsTypes`, editingSudsId), sudsData);
        showCustomModal("Tipo de SUDS actualizado con éxito.");
      } else {
        await addDoc(collection(db, `artifacts/${appId}/public/data/sudsTypes`), sudsData);
        showCustomModal("Nuevo tipo de SUDS añadido con éxito.");
      }
      setNewSudsName('');
      setNewSudsDescription('');
      setNewSudsImageUrl('');
      setNewSudsLocationTypes([]);
      setEditingSudsId(null);
      setShowAddSudsForm(false);
    } catch (error) {
      console.error("Error adding/updating SUDS type:", error);
      showCustomModal(`Error al guardar tipo de SUDS: ${error.message}`);
    }
  };

  const handleEditSuds = (suds) => {
    setNewSudsName(suds.name);
    setNewSudsDescription(suds.description);
    setNewSudsImageUrl(suds.imageUrls && suds.imageUrls.length > 0 ? suds.imageUrls[0] : '');
    setNewSudsLocationTypes(suds.locationTypes || []);
    setEditingSudsId(suds.id);
    setShowAddSudsForm(true);
  };

  const handleDeleteSuds = async (id) => {
    if (!db) {
      showCustomModal("La base de datos no está disponible.");
      return;
    }
    showCustomModal(
      "¿Estás seguro de que quieres eliminar este tipo de SUDS?",
      async () => {
        try {
          await deleteDoc(doc(db, `artifacts/${appId}/public/data/sudsTypes`, id));
          showCustomModal("Tipo de SUDS eliminado con éxito.");
        } catch (error) {
          console.error("Error deleting SUDS type:", error);
          showCustomModal(`Error al eliminar tipo de SUDS: ${error.message}`);
        }
      },
      true
    );
  };

  const filteredSudsTypes = sudsTypes.filter(suds => {
    if (filterLocationTypes.length === 0) return true;
    return filterLocationTypes.some(filterType => suds.locationTypes?.includes(filterType));
  }).sort((a,b) => (a.order || 9999) - (b.order || 9999));


  if (loading) {
    return <div className="text-center text-gray-600">Cargando tipos de SUDS...</div>;
  }
   if (!db) {
    return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible. Verifica la configuración de Firebase.</div>;
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2 flex justify-between items-center">
        Tipos de SUDS
        {canEdit && (
          <button
            onClick={() => setShowAddSudsForm(!showAddSudsForm)}
            className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-md text-xl leading-none"
            title={showAddSudsForm ? "Ocultar formulario" : "Añadir nuevo tipo de SUDS"}
          >
            {showAddSudsForm ? '−' : '+'}
          </button>
        )}
      </h2>

      {canEdit && showAddSudsForm && (
        <div className="mb-8 p-6 bg-blue-50 rounded-lg border border-blue-200">
          <h3 className="text-xl font-semibold text-blue-800 mb-4">{editingSudsId ? 'Editar Tipo de SUDS' : 'Añadir Nuevo Tipo de SUDS'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="sudsName" className="block text-sm font-medium text-gray-700 mb-1">Nombre del SUDS</label>
              <input
                type="text"
                id="sudsName"
                value={newSudsName}
                onChange={(e) => setNewSudsName(e.target.value)}
                placeholder="Ej: Zanja de infiltración"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="sudsDescription" className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <div className="flex items-center space-x-2">
                <textarea
                  id="sudsDescription"
                  value={newSudsDescription}
                  onChange={(e) => setNewSudsDescription(e.target.value)}
                  placeholder="Descripción detallada del tipo de SUDS..."
                  rows="3"
                  className="flex-grow p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                ></textarea>
                <button
                  onClick={handleGenerateSudsDescription}
                  disabled={generatingDescription}
                  className="p-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Generar descripción con IA"
                >
                  {generatingDescription ? 'Generando...' : '✨ Generar'}
                </button>
              </div>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="sudsImageUrl" className="block text-sm font-medium text-gray-700 mb-1">URL de Imagen (opcional)</label>
              <input
                type="url"
                id="sudsImageUrl"
                value={newSudsImageUrl}
                onChange={(e) => setNewSudsImageUrl(e.target.value)}
                placeholder="https://ejemplo.com/imagen.jpg"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="md:col-span-2">
              <span className="block text-sm font-medium text-gray-700 mb-1">Tipos de Ubicación</span>
              <div className="flex flex-wrap gap-2">
                {locationTypeOptions.map(option => (
                  <label key={option.id} className="inline-flex items-center">
                    <input
                      type="checkbox"
                      value={option.id}
                      checked={newSudsLocationTypes.includes(option.id)}
                      onChange={() => handleToggleLocationType(option.id)}
                      className="form-checkbox h-5 w-5 text-blue-600"
                    />
                    <span className="ml-2 text-gray-700">{option.icon} {option.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            {editingSudsId && (
              <button
                onClick={() => {
                  setEditingSudsId(null);
                  setShowAddSudsForm(false);
                  setNewSudsName('');
                  setNewSudsDescription('');
                  setNewSudsImageUrl('');
                  setNewSudsLocationTypes([]);
                }}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors"
              >
                Cancelar
              </button>
            )}
            <button
              onClick={handleAddOrUpdateSuds}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors shadow-md"
            >
              {editingSudsId ? 'Actualizar SUDS' : 'Añadir SUDS'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros de SUDS */}
      <div className="mb-6 p-4 bg-gray-100 rounded-lg border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-700 mb-2">Filtrar por Tipo de Ubicación:</h3>
        <div className="flex flex-wrap gap-2">
          {locationTypeOptions.map(option => (
            <label key={`filter-${option.id}`} className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                value={option.id}
                checked={filterLocationTypes.includes(option.id)}
                onChange={() => handleToggleFilterLocationType(option.id)}
                className="form-checkbox h-5 w-5 text-blue-600"
              />
              <span className="ml-2 text-gray-700">{option.icon} {option.name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Lista de SUDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSudsTypes.map(suds => (
          <div key={suds.id} className="bg-white rounded-lg shadow-lg overflow-hidden flex flex-col border border-gray-200">
            {suds.imageUrls && suds.imageUrls.length > 0 ? (
              <img
                src={suds.imageUrls[0]}
                alt={suds.name}
                className="w-full h-48 object-cover"
                onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/400x300/cccccc/ffffff?text=${suds.name.slice(0, 10)}`; }}
              />
            ) : (
              <div className="w-full h-48 bg-gray-300 flex items-center justify-center text-gray-500 text-lg">No hay imagen</div>
            )}
            <div className="p-5 flex-grow">
              <h3 className="text-xl font-bold text-gray-800 mb-2">{suds.name}</h3>
              <p className="text-gray-600 text-sm mb-3">{suds.description}</p>
              <div className="flex flex-wrap gap-2 mb-3 text-sm">
                {suds.locationTypes?.map(typeId => {
                  const type = locationTypeOptions.find(opt => opt.id === typeId);
                  return type ? (
                    <span key={typeId} className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full flex items-center space-x-1">
                      <span>{type.icon}</span><span>{type.name}</span>
                    </span>
                  ) : null;
                })}
              </div>
              <p className="text-gray-500 text-xs mt-auto">Última actualización: {suds.timestamp?.toDate().toLocaleString() || 'N/A'}</p>
            </div>
            {canEdit && (
              <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-2">
                <button
                  onClick={() => handleMoveSudsType(suds.id, 'up', sudsTypes)}
                  className="p-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors text-sm"
                  title="Mover arriba"
                >
                  ▲
                </button>
                <button
                  onClick={() => handleMoveSudsType(suds.id, 'down', sudsTypes)}
                  className="p-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors text-sm"
                  title="Mover abajo"
                >
                  ▼
                </button>
                <button
                  onClick={() => handleEditSuds(suds)}
                  className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDeleteSuds(suds.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm"
                >
                  Eliminar
                </button>
              </div>
            )}
          </div>
        ))}
        {filteredSudsTypes.length === 0 && !loading && (
          <p className="text-center text-gray-500 md:col-span-3">No hay tipos de SUDS que coincidan con los filtros.</p>
        )}
      </div>
    </div>
  );
};

// --- Tab 2: Contratos de Mantenimiento ---
const ContractsTab = () => {
  const { db, userId, appId, showCustomModal } = useAppContext();
  const [contracts, setContracts] = useState([]);
  const [newContractName, setNewContractName] = useState('');
  const [newContractStartDate, setNewContractStartDate] = useState('');
  const [newContractEndDate, setNewContractEndDate] = useState('');
  const [editingContractId, setEditingContractId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddContractForm, setShowAddContractForm] = useState(false);
  const canEdit = true;

  useEffect(() => {
    if (!db || !appId) {
      setLoading(false);
      return;
    }

    const q = collection(db, `artifacts/${appId}/public/data/contracts`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedContracts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setContracts(fetchedContracts);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching contracts:", error);
      showCustomModal(`Error al cargar contratos: ${error.message}`);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, appId, showCustomModal]);

  const handleAddOrUpdateContract = async () => {
    if (!db) {
      showCustomModal("La base de datos no está disponible.");
      return;
    }
    if (!newContractName.trim() || !newContractStartDate || !newContractEndDate) {
      showCustomModal("Por favor, rellena todos los campos del contrato.");
      return;
    }

    try {
      const contractData = {
        name: newContractName.trim(),
        startDate: newContractStartDate,
        endDate: newContractEndDate,
        lastUpdatedBy: userId,
        timestamp: new Date(),
      };

      if (editingContractId) {
        await updateDoc(doc(db, `artifacts/${appId}/public/data/contracts`, editingContractId), contractData);
        showCustomModal("Contrato actualizado con éxito.");
      } else {
        await addDoc(collection(db, `artifacts/${appId}/public/data/contracts`), contractData);
        showCustomModal("Nuevo contrato añadido con éxito.");
      }
      setNewContractName('');
      setNewContractStartDate('');
      setNewContractEndDate('');
      setEditingContractId(null);
      setShowAddContractForm(false);
    } catch (error) {
      console.error("Error adding/updating contract:", error);
      showCustomModal(`Error al guardar contrato: ${error.message}`);
    }
  };

  const handleEditContract = (contract) => {
    setNewContractName(contract.name);
    setNewContractStartDate(contract.startDate);
    setNewContractEndDate(contract.endDate);
    setEditingContractId(contract.id);
    setShowAddContractForm(true);
  };

  const handleDeleteContract = async (id) => {
    if (!db) {
      showCustomModal("La base de datos no está disponible.");
      return;
    }
    showCustomModal(
      "¿Estás seguro de que quieres eliminar este contrato? Se eliminarán también las actividades de mantenimiento asociadas.",
      async () => {
        try {
          // Obtener actividades de mantenimiento relacionadas
          const activitiesRef = collection(db, `artifacts/${appId}/public/data/maintenanceActivities`);
          const q = query(activitiesRef, where("contractId", "==", id));
          const snapshot = await getDocs(q);

          const batch = writeBatch(db);
          snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
          });
          // Eliminar el contrato
          batch.delete(doc(db, `artifacts/${appId}/public/data/contracts`, id));
          await batch.commit();

          showCustomModal("Contrato y actividades asociadas eliminados con éxito.");
        } catch (error) {
          console.error("Error deleting contract:", error);
          showCustomModal(`Error al eliminar contrato: ${error.message}`);
        }
      },
      true
    );
  };

  if (loading) {
    return <div className="text-center text-gray-600">Cargando contratos...</div>;
  }
  if (!db) {
    return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible. Verifica la configuración de Firebase.</div>;
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2 flex justify-between items-center">
        Contratos de Mantenimiento
        {canEdit && (
          <button
            onClick={() => setShowAddContractForm(!showAddContractForm)}
            className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-md text-xl leading-none"
            title={showAddContractForm ? "Ocultar formulario" : "Añadir nuevo contrato"}
          >
            {showAddContractForm ? '−' : '+'}
          </button>
        )}
      </h2>

      {canEdit && showAddContractForm && (
        <div className="mb-8 p-6 bg-blue-50 rounded-lg border border-blue-200">
          <h3 className="text-xl font-semibold text-blue-800 mb-4">{editingContractId ? 'Editar Contrato' : 'Añadir Nuevo Contrato'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="contractName" className="block text-sm font-medium text-gray-700 mb-1">Nombre del Contrato</label>
              <input
                type="text"
                id="contractName"
                value={newContractName}
                onChange={(e) => setNewContractName(e.target.value)}
                placeholder="Ej: Contrato 2024-01"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">Fecha de Inicio</label>
              <input
                type="date"
                id="startDate"
                value={newContractStartDate}
                onChange={(e) => setNewContractStartDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">Fecha de Fin</label>
              <input
                type="date"
                id="endDate"
                value={newContractEndDate}
                onChange={(e) => setNewContractEndDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            {editingContractId && (
              <button
                onClick={() => {
                  setEditingContractId(null);
                  setShowAddContractForm(false);
                  setNewContractName('');
                  setNewContractStartDate('');
                  setNewContractEndDate('');
                }}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors"
              >
                Cancelar
              </button>
            )}
            <button
              onClick={handleAddOrUpdateContract}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors shadow-md"
            >
              {editingContractId ? 'Actualizar Contrato' : 'Añadir Contrato'}
            </button>
          </div>
        </div>
      )}

      {/* Lista de Contratos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {contracts.map(contract => (
          <div key={contract.id} className="bg-white rounded-lg shadow-lg overflow-hidden flex flex-col border border-gray-200">
            <div className="p-5 flex-grow">
              <h3 className="text-xl font-bold text-gray-800 mb-2">{contract.name}</h3>
              <p className="text-gray-600 text-sm mb-1">Inicio: {contract.startDate}</p>
              <p className="text-gray-600 text-sm mb-3">Fin: {contract.endDate}</p>
              <p className="text-gray-500 text-xs mt-auto">Última actualización: {contract.timestamp?.toDate().toLocaleString() || 'N/A'}</p>
            </div>
            {canEdit && (
              <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-2">
                <button
                  onClick={() => handleEditContract(contract)}
                  className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDeleteContract(contract.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm"
                >
                  Eliminar
                </button>
              </div>
            )}
          </div>
        ))}
        {contracts.length === 0 && !loading && (
          <p className="text-center text-gray-500 md:col-span-3">No hay contratos registrados.</p>
        )}
      </div>
    </div>
  );
};

// --- Tab 3: Definición de Actividades por SUDS ---
const SudsActivityDefinitionTab = () => {
  const { db, userId, appId, showCustomModal, handleMoveActivityColumn } = useAppContext();
  const [sudsTypes, setSudsTypes] = useState([]);
  const [selectedSudsTypeId, setSelectedSudsTypeId] = useState('');
  const [maintenanceCategories, setMaintenanceCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newActivityName, setNewActivityName] = useState('');
  const [selectedCategoryForActivity, setSelectedCategoryForActivity] = useState('');
  const [definedActivityNames, setDefinedActivityNames] = useState({}); // { category: [activityName, ...] }
  const [loading, setLoading] = useState(true);
  const canEdit = true;

  useEffect(() => {
    if (!db || !appId) {
      setLoading(false);
      return;
    }

    const unsubscribeSudsTypes = onSnapshot(collection(db, `artifacts/${appId}/public/data/sudsTypes`), (snapshot) => {
      setSudsTypes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching SUDS types for definition:", error);
      showCustomModal(`Error al cargar tipos de SUDS: ${error.message}`);
    });

    const unsubscribeCategories = onSnapshot(doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories'), (docSnap) => {
      if (docSnap.exists()) {
        setMaintenanceCategories(docSnap.data().categories || []);
      } else {
        setMaintenanceCategories([]);
      }
    }, (error) => {
      console.error("Error fetching maintenance categories:", error);
      showCustomModal(`Error al cargar categorías de mantenimiento: ${error.message}`);
    });

    const unsubscribeDefinedActivities = onSnapshot(doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames'), (docSnap) => {
      if (docSnap.exists()) {
        setDefinedActivityNames(docSnap.data() || {});
      } else {
        setDefinedActivityNames({});
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching defined activity names:", error);
      showCustomModal(`Error al cargar nombres de actividad: ${error.message}`);
      setLoading(false);
    });

    return () => {
      unsubscribeSudsTypes();
      unsubscribeCategories();
      unsubscribeDefinedActivities();
    };
  }, [db, appId, showCustomModal]);

  const handleAddCategory = async () => {
    if (!db) { showCustomModal("La base de datos no está disponible."); return; }
    if (!newCategoryName.trim()) { showCustomModal("Por favor, introduce un nombre para la categoría."); return; }

    const categoryNameToAdd = newCategoryName.trim();
    if (maintenanceCategories.includes(categoryNameToAdd)) {
      showCustomModal("Esta categoría ya existe.");
      return;
    }

    try {
      const docRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories');
      await setDoc(docRef, { categories: [...maintenanceCategories, categoryNameToAdd] }, { merge: true });
      setNewCategoryName('');
      showCustomModal("Categoría añadida con éxito.");
    } catch (error) {
      console.error("Error adding category:", error);
      showCustomModal(`Error al añadir categoría: ${error.message}`);
    }
  };

  const handleDeleteCategory = async (categoryToDelete) => {
    if (!db) { showCustomModal("La base de datos no está disponible."); return; }
    showCustomModal(`¿Estás seguro de que quieres eliminar la categoría '${categoryToDelete}' y todas sus actividades definidas?`,
      async () => {
        try {
          const docRefCategories = doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories');
          await updateDoc(docRefCategories, {
            categories: maintenanceCategories.filter(cat => cat !== categoryToDelete)
          });

          // También eliminar las actividades definidas para esa categoría
          const newDefinedActivities = { ...definedActivityNames };
          delete newDefinedActivities[categoryToDelete];
          await setDoc(doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames'), newDefinedActivities);

          showCustomModal("Categoría y actividades eliminadas con éxito.");
        } catch (error) {
          console.error("Error deleting category:", error);
          showCustomModal(`Error al eliminar categoría: ${error.message}`);
        }
      },
      true
    );
  };

  const handleAddActivity = async () => {
    if (!db) { showCustomModal("La base de datos no está disponible."); return; }
    if (!selectedCategoryForActivity || !newActivityName.trim()) {
      showCustomModal("Por favor, selecciona una categoría e introduce un nombre para la actividad.");
      return;
    }
    const activityNameToAdd = newActivityName.trim();
    const currentActivities = definedActivityNames[selectedCategoryForActivity] || [];

    if (currentActivities.includes(activityNameToAdd)) {
      showCustomModal("Esta actividad ya existe en la categoría seleccionada.");
      return;
    }

    try {
      const docRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames');
      await setDoc(docRef, {
        [selectedCategoryForActivity]: [...currentActivities, activityNameToAdd]
      }, { merge: true });
      setNewActivityName('');
      showCustomModal("Actividad añadida con éxito.");
    } catch (error) {
      console.error("Error adding activity:", error);
      showCustomModal(`Error al añadir actividad: ${error.message}`);
    }
  };

  const handleDeleteActivity = async (category, activityToDelete) => {
    if (!db) { showCustomModal("La base de datos no está disponible."); return; }
    showCustomModal(`¿Estás seguro de que quieres eliminar la actividad '${activityToDelete}' de la categoría '${category}'?`,
      async () => {
        try {
          const docRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames');
          const currentActivities = definedActivityNames[category] || [];
          await updateDoc(docRef, {
            [category]: currentActivities.filter(act => act !== activityToDelete)
          });
          showCustomModal("Actividad eliminada con éxito.");
        } catch (error) {
          console.error("Error deleting activity:", error);
          showCustomModal(`Error al eliminar actividad: ${error.message}`);
        }
      },
      true
    );
  };

  const handleApplyActivitiesToSuds = async () => {
    if (!db) { showCustomModal("La base de datos no está disponible."); return; }
    if (!selectedSudsTypeId) {
      showCustomModal("Por favor, selecciona un tipo de SUDS.");
      return;
    }

    const selectedSudsType = sudsTypes.find(s => s.id === selectedSudsTypeId);
    if (!selectedSudsType) {
      showCustomModal("Tipo de SUDS seleccionado no encontrado.");
      return;
    }

    const currentSudsActivities = selectedSudsType.activities || {};
    const batch = writeBatch(db);

    maintenanceCategories.forEach(category => {
      const definedActivities = definedActivityNames[category] || [];
      const currentCategoryActivities = currentSudsActivities[category] || [];

      // Add new activities from defined
      definedActivities.forEach(activityName => {
        if (!currentCategoryActivities.some(a => a.name === activityName)) {
          currentCategoryActivities.push({ name: activityName, defaultFrequency: 'Mensual' }); // Add with a default frequency
        }
      });

      // Remove activities no longer defined
      const updatedCategoryActivities = currentCategoryActivities.filter(activity =>
        definedActivities.includes(activity.name)
      );

      currentSudsActivities[category] = updatedCategoryActivities;
    });

    batch.update(doc(db, `artifacts/${appId}/public/data/sudsTypes`, selectedSudsTypeId), {
      activities: currentSudsActivities,
      lastUpdatedBy: userId,
      timestamp: new Date()
    });

    try {
      await batch.commit();
      showCustomModal(`Actividades aplicadas a '${selectedSudsType.name}' con éxito.`);
    } catch (error) {
      console.error("Error applying activities:", error);
      showCustomModal(`Error al aplicar actividades: ${error.message}`);
    }
  };

  if (loading) {
    return <div className="text-center text-gray-600">Cargando definición de actividades...</div>;
  }
   if (!db) {
    return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible. Verifica la configuración de Firebase.</div>;
  }

  const sudsActivities = sudsTypes.find(s => s.id === selectedSudsTypeId)?.activities || {};

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">Definición de Actividades por SUDS</h2>

      {/* Gestión de Categorías de Mantenimiento */}
      <div className="mb-8 p-6 bg-yellow-50 rounded-lg border border-yellow-200">
        <h3 className="text-xl font-semibold text-yellow-800 mb-4">Gestión de Categorías de Mantenimiento</h3>
        <div className="flex mb-4">
          <input
            type="text"
            placeholder="Nueva Categoría"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            className="flex-grow p-2 border border-gray-300 rounded-l-md focus:ring-yellow-500 focus:border-yellow-500"
          />
          <button
            onClick={handleAddCategory}
            className="px-4 py-2 bg-yellow-600 text-white rounded-r-md hover:bg-yellow-700 transition-colors shadow-md"
          >
            Añadir Categoría
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {maintenanceCategories.map(category => (
            <span key={category} className="inline-flex items-center px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm">
              {category}
              <button
                onClick={() => handleDeleteCategory(category)}
                className="ml-2 -mr-1 h-5 w-5 flex items-center justify-center rounded-full hover:bg-yellow-200 text-yellow-600"
                title="Eliminar categoría"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Gestión de Actividades Definidas por Categoría */}
      <div className="mb-8 p-6 bg-green-50 rounded-lg border border-green-200">
        <h3 className="text-xl font-semibold text-green-800 mb-4">Gestión de Actividades Definidas por Categoría</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="selectCategory" className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Categoría</label>
            <select
              id="selectCategory"
              value={selectedCategoryForActivity}
              onChange={(e) => setSelectedCategoryForActivity(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
            >
              <option value="">-- Selecciona una categoría --</option>
              {maintenanceCategories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="newActivity" className="block text-sm font-medium text-gray-700 mb-1">Nueva Actividad</label>
            <div className="flex">
              <input
                type="text"
                id="newActivity"
                placeholder="Ej: Revisión visual"
                value={newActivityName}
                onChange={(e) => setNewActivityName(e.target.value)}
                className="flex-grow p-2 border border-gray-300 rounded-l-md focus:ring-green-500 focus:border-green-500"
              />
              <button
                onClick={handleAddActivity}
                className="px-4 py-2 bg-green-600 text-white rounded-r-md hover:bg-green-700 transition-colors shadow-md"
              >
                Añadir Actividad
              </button>
            </div>
          </div>
        </div>

        {selectedCategoryForActivity && (
          <div className="mt-4">
            <h4 className="font-semibold text-gray-700 mb-2">Actividades en "{selectedCategoryForActivity}":</h4>
            <div className="flex flex-wrap gap-2">
              {(definedActivityNames[selectedCategoryForActivity] || []).map(activityName => (
                <span key={activityName} className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                  {activityName}
                  <button
                    onClick={() => handleMoveActivityColumn(selectedCategoryForActivity, activityName, 'left', definedActivityNames)}
                    className="ml-2 h-5 w-5 flex items-center justify-center rounded-full hover:bg-green-200 text-green-600"
                    title="Mover a la izquierda"
                  >
                    &#9664;
                  </button>
                  <button
                    onClick={() => handleMoveActivityColumn(selectedCategoryForActivity, activityName, 'right', definedActivityNames)}
                    className="ml-0 h-5 w-5 flex items-center justify-center rounded-full hover:bg-green-200 text-green-600"
                    title="Mover a la derecha"
                  >
                    &#9654;
                  </button>
                  <button
                    onClick={() => handleDeleteActivity(selectedCategoryForActivity, activityName)}
                    className="ml-2 -mr-1 h-5 w-5 flex items-center justify-center rounded-full hover:bg-green-200 text-green-600"
                    title="Eliminar actividad"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Aplicar Actividades a Tipos de SUDS Específicos */}
      <div className="mb-8 p-6 bg-purple-50 rounded-lg border border-purple-200">
        <h3 className="text-xl font-semibold text-purple-800 mb-4">Aplicar Actividades a Tipos de SUDS</h3>
        <div className="mb-4">
          <label htmlFor="selectSudsType" className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Tipo de SUDS</label>
          <select
            id="selectSudsType"
            value={selectedSudsTypeId}
            onChange={(e) => setSelectedSudsTypeId(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
          >
            <option value="">-- Selecciona un tipo de SUDS --</option>
            {sudsTypes.map(suds => (
              <option key={suds.id} value={suds.id}>{suds.name}</option>
            ))}
          </select>
        </div>
        {selectedSudsTypeId && (
          <div className="mb-4">
            <h4 className="font-semibold text-gray-700 mb-2">Actividades actuales para "{sudsTypes.find(s => s.id === selectedSudsTypeId)?.name}":</h4>
            {maintenanceCategories.map(category => (
              <div key={category} className="mb-2">
                <p className="font-medium text-gray-600">{category}:</p>
                <div className="flex flex-wrap gap-2">
                  {(sudsActivities[category] || []).map(activity => (
                    <span key={activity.name} className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                      {activity.name} ({activity.defaultFrequency || 'Sin frecuencia'})
                    </span>
                  ))}
                  {(sudsActivities[category] || []).length === 0 && <span className="text-gray-500 text-sm italic">Ninguna actividad definida</span>}
                </div>
              </div>
            ))}
            <button
              onClick={handleApplyActivitiesToSuds}
              className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors shadow-md"
            >
              Aplicar Actividades Definidas
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Tab 4: Detalle de Actividades por SUDS ---
const SudsActivityDetailsTab = () => {
  const { db, userId, userRole, appId, showCustomModal } = useAppContext();
  const [sudsTypes, setSudsTypes] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [maintenanceActivities, setMaintenanceActivities] = useState([]);
  const [selectedSudsTypeId, setSelectedSudsTypeId] = useState('');
  const [selectedContractId, setSelectedContractId] = useState('');
  const [newActivityDetails, setNewActivityDetails] = useState('');
  const [newActivityDate, setNewActivityDate] = useState('');
  const [newActivityFrequency, setNewActivityFrequency] = useState('Mensual');
  const [newActivityName, setNewActivityName] = useState('');
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [loading, setLoading] = useState(true);
  const canEdit = true; // Simplified for demo: all users can edit

  const frequencyOptions = ['Diario', 'Semanal', 'Mensual', 'Trimestral', 'Anual'];

  useEffect(() => {
    if (!db || !appId) {
      setLoading(false);
      return;
    }

    const unsubscribeSuds = onSnapshot(collection(db, `artifacts/${appId}/public/data/sudsTypes`), (snapshot) => {
      setSudsTypes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching SUDS types for activities:", error);
      showCustomModal(`Error al cargar tipos de SUDS: ${error.message}`);
    });

    const unsubscribeContracts = onSnapshot(collection(db, `artifacts/${appId}/public/data/contracts`), (snapshot) => {
      setContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching contracts for activities:", error);
      showCustomModal(`Error al cargar contratos: ${error.message}`);
    });

    const unsubscribeActivities = onSnapshot(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`), (snapshot) => {
      setMaintenanceActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching maintenance activities:", error);
      showCustomModal(`Error al cargar actividades de mantenimiento: ${error.message}`);
      setLoading(false);
    });

    return () => {
      unsubscribeSuds();
      unsubscribeContracts();
      unsubscribeActivities();
    };
  }, [db, appId, showCustomModal]);

  const handleAddOrUpdateActivity = async () => {
    if (!db) {
      showCustomModal("La base de datos no está disponible.");
      return;
    }
    if (!selectedSudsTypeId || !selectedContractId || !newActivityName.trim() || !newActivityDetails.trim() || !newActivityDate || !newActivityFrequency) {
      showCustomModal("Por favor, rellena todos los campos de la actividad.");
      return;
    }

    try {
      const activityData = {
        sudsTypeId: selectedSudsTypeId,
        contractId: selectedContractId,
        activityName: newActivityName.trim(),
        details: newActivityDetails.trim(),
        date: newActivityDate,
        frequency: newActivityFrequency,
        lastUpdatedBy: userId,
        timestamp: new Date(),
      };

      if (editingActivityId) {
        await updateDoc(doc(db, `artifacts/${appId}/public/data/maintenanceActivities`, editingActivityId), activityData);
        showCustomModal("Actividad de mantenimiento actualizada con éxito.");
      } else {
        await addDoc(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`), activityData);
        showCustomModal("Nueva actividad de mantenimiento añadida con éxito.");
      }
      resetForm();
    } catch (error) {
      console.error("Error adding/updating activity:", error);
      showCustomModal(`Error al guardar actividad de mantenimiento: ${error.message}`);
    }
  };

  const handleEditActivity = (activity) => {
    setNewActivityName(activity.activityName);
    setNewActivityDetails(activity.details);
    setNewActivityDate(activity.date);
    setNewActivityFrequency(activity.frequency);
    setSelectedSudsTypeId(activity.sudsTypeId);
    setSelectedContractId(activity.contractId);
    setEditingActivityId(activity.id);
  };

  const handleDeleteActivity = async (id) => {
    if (!db) {
      showCustomModal("La base de datos no está disponible.");
      return;
    }
    showCustomModal(
      "¿Estás seguro de que quieres eliminar esta actividad de mantenimiento?",
      async () => {
        try {
          await deleteDoc(doc(db, `artifacts/${appId}/public/data/maintenanceActivities`, id));
          showCustomModal("Actividad de mantenimiento eliminada con éxito.");
        } catch (error) {
          console.error("Error deleting activity:", error);
          showCustomModal(`Error al eliminar actividad de mantenimiento: ${error.message}`);
        }
      },
      true
    );
  };

  const resetForm = () => {
    setSelectedSudsTypeId('');
    setSelectedContractId('');
    setNewActivityName('');
    setNewActivityDetails('');
    setNewActivityDate('');
    setNewActivityFrequency('Mensual');
    setEditingActivityId(null);
  };

  const filteredActivities = maintenanceActivities.filter(activity => {
    return (!selectedSudsTypeId || activity.sudsTypeId === selectedSudsTypeId) &&
           (!selectedContractId || activity.contractId === selectedContractId);
  });

  if (loading) {
    return <div className="text-center text-gray-600">Cargando detalles de actividades...</div>;
  }
   if (!db) {
    return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible. Verifica la configuración de Firebase.</div>;
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">Detalle de Actividades por SUDS</h2>

      {/* Formulario de Añadir/Editar Actividad */}
      {canEdit && (
        <div className="mb-8 p-6 bg-blue-50 rounded-lg border border-blue-200">
          <h3 className="text-xl font-semibold text-blue-800 mb-4">{editingActivityId ? 'Editar Actividad' : 'Añadir Nueva Actividad'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="sudsTypeSelect" className="block text-sm font-medium text-gray-700 mb-1">Tipo de SUDS</label>
              <select
                id="sudsTypeSelect"
                value={selectedSudsTypeId}
                onChange={(e) => setSelectedSudsTypeId(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                disabled={editingActivityId !== null}
              >
                <option value="">-- Selecciona un SUDS --</option>
                {sudsTypes.map(suds => (
                  <option key={suds.id} value={suds.id}>{suds.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contractSelect" className="block text-sm font-medium text-gray-700 mb-1">Contrato</label>
              <select
                id="contractSelect"
                value={selectedContractId}
                onChange={(e) => setSelectedContractId(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                disabled={editingActivityId !== null}
              >
                <option value="">-- Selecciona un Contrato --</option>
                {contracts.map(contract => (
                  <option key={contract.id} value={contract.id}>{contract.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="activityName" className="block text-sm font-medium text-gray-700 mb-1">Nombre de Actividad</label>
              <input
                type="text"
                id="activityName"
                value={newActivityName}
                onChange={(e) => setNewActivityName(e.target.value)}
                placeholder="Ej: Inspección visual"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="activityDate" className="block text-sm font-medium text-gray-700 mb-1">Fecha de Realización</label>
              <input
                type="date"
                id="activityDate"
                value={newActivityDate}
                onChange={(e) => setNewActivityDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="activityFrequency" className="block text-sm font-medium text-gray-700 mb-1">Frecuencia</label>
              <select
                id="activityFrequency"
                value={newActivityFrequency}
                onChange={(e) => setNewActivityFrequency(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                {frequencyOptions.map(freq => (
                  <option key={freq} value={freq}>{freq}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="activityDetails" className="block text-sm font-medium text-gray-700 mb-1">Detalles de la Actividad</label>
              <textarea
                id="activityDetails"
                value={newActivityDetails}
                onChange={(e) => setNewActivityDetails(e.target.value)}
                placeholder="Observaciones, resultados de inspección..."
                rows="3"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              ></textarea>
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            {editingActivityId && (
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors"
              >
                Cancelar
              </button>
            )}
            <button
              onClick={handleAddOrUpdateActivity}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors shadow-md"
            >
              {editingActivityId ? 'Actualizar Actividad' : 'Añadir Actividad'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros de Actividades */}
      <div className="mb-6 p-4 bg-gray-100 rounded-lg border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-700 mb-2">Filtrar Actividades:</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="filterSudsType" className="block text-sm font-medium text-gray-700 mb-1">Tipo de SUDS</label>
            <select
              id="filterSudsType"
              value={selectedSudsTypeId}
              onChange={(e) => setSelectedSudsTypeId(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- Todos los SUDS --</option>
              {sudsTypes.map(suds => (
                <option key={suds.id} value={suds.id}>{suds.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filterContract" className="block text-sm font-medium text-gray-700 mb-1">Contrato</label>
            <select
              id="filterContract"
              value={selectedContractId}
              onChange={(e) => setSelectedContractId(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- Todos los Contratos --</option>
              {contracts.map(contract => (
                <option key={contract.id} value={contract.id}>{contract.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Lista de Actividades */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredActivities.length > 0 ? (
          filteredActivities.map(activity => {
            const sudsName = sudsTypes.find(s => s.id === activity.sudsTypeId)?.name || 'Desconocido';
            const contractName = contracts.find(c => c.id === activity.contractId)?.name || 'Desconocido';
            return (
              <div key={activity.id} className="bg-white rounded-lg shadow-lg overflow-hidden flex flex-col border border-gray-200">
                <div className="p-5 flex-grow">
                  <h3 className="text-lg font-bold text-gray-800 mb-2">{activity.activityName}</h3>
                  <p className="text-gray-600 text-sm mb-1">SUDS: {sudsName}</p>
                  <p className="text-gray-600 text-sm mb-1">Contrato: {contractName}</p>
                  <p className="text-gray-600 text-sm mb-1">Fecha: {activity.date}</p>
                  <p className="text-gray-600 text-sm mb-3">Frecuencia: {activity.frequency}</p>
                  <p className="text-gray-600 text-sm mb-3">Detalles: {activity.details}</p>
                  <p className="text-gray-500 text-xs mt-auto">Última actualización: {activity.timestamp?.toDate().toLocaleString() || 'N/A'}</p>
                </div>
                {canEdit && (
                  <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-2">
                    <button
                      onClick={() => handleEditActivity(activity)}
                      className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteActivity(activity.id)}
                      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="text-center text-gray-500 md:col-span-3">No hay actividades que coincidan con los filtros.</p>
        )}
      </div>
    </div>
  );
};


// --- Tab 5: Resumen por Contrato y Validación ---
const SummaryTab = () => {
  const { db, appId, showCustomModal } = useAppContext();
  const [sudsTypes, setSudsTypes] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [maintenanceActivities, setMaintenanceActivities] = useState([]);
  const [activityNames, setActivityNames] = useState({}); // { category: [activityName, ...] }
  const [selectedContractId, setSelectedContractId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db || !appId) {
      setLoading(false);
      return;
    }

    const unsubscribeSuds = onSnapshot(collection(db, `artifacts/${appId}/public/data/sudsTypes`), (snapshot) => {
      setSudsTypes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching SUDS types for summary:", error);
      showCustomModal(`Error al cargar tipos de SUDS: ${error.message}`);
    });

    const unsubscribeContracts = onSnapshot(collection(db, `artifacts/${appId}/public/data/contracts`), (snapshot) => {
      setContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching contracts for summary:", error);
      showCustomModal(`Error al cargar contratos: ${error.message}`);
    });

    const unsubscribeActivities = onSnapshot(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`), (snapshot) => {
      setMaintenanceActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching maintenance activities for summary:", error);
      showCustomModal(`Error al cargar actividades de mantenimiento: ${error.message}`);
    });

    const unsubscribeActivityNames = onSnapshot(doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames'), (docSnap) => {
      if (docSnap.exists()) {
        setActivityNames(docSnap.data() || {});
      } else {
        setActivityNames({});
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching defined activity names for summary:", error);
      showCustomModal(`Error al cargar nombres de actividad: ${error.message}`);
      setLoading(false);
    });

    return () => {
      unsubscribeSuds();
      unsubscribeContracts();
      unsubscribeActivities();
      unsubscribeActivityNames();
    };
  }, [db, appId, showCustomModal]);

  const getContractSummary = () => {
    if (!selectedContractId) return null;

    const contract = contracts.find(c => c.id === selectedContractId);
    if (!contract) return null;

    const sudsTypesForContract = sudsTypes.filter(suds => {
      // Logic to determine which SUDS types are relevant to this contract
      // This might depend on contract details not available in current schema,
      // so for now, consider all SUDS types potentially part of a contract.
      return true;
    });

    const summary = sudsTypesForContract.map(suds => {
      const sudsActivities = suds.activities || {};
      const activitiesBySuds = {};

      Object.keys(activityNames).forEach(category => {
        const definedActivities = activityNames[category] || [];
        activitiesBySuds[category] = definedActivities.map(activityName => {
          const completedActivity = maintenanceActivities.find(
            ma => ma.sudsTypeId === suds.id &&
                  ma.contractId === selectedContractId &&
                  ma.activityName === activityName
          );
          return {
            name: activityName,
            completed: !!completedActivity,
            date: completedActivity ? completedActivity.date : '',
            details: completedActivity ? completedActivity.details : '',
          };
        });
      });
      return {
        sudsId: suds.id,
        sudsName: suds.name,
        activities: activitiesBySuds,
      };
    });
    return summary;
  };

  const contractSummary = getContractSummary();

  if (loading) {
    return <div className="text-center text-gray-600">Cargando resumen...</div>;
  }
   if (!db) {
    return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible. Verifica la configuración de Firebase.</div>;
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">Resumen por Contrato y Validación</h2>

      <div className="mb-6 p-4 bg-gray-100 rounded-lg border border-gray-200">
        <label htmlFor="selectContract" className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Contrato</label>
        <select
          id="selectContract"
          value={selectedContractId}
          onChange={(e) => setSelectedContractId(e.target.value)}
          className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">-- Selecciona un Contrato --</option>
          {contracts.map(contract => (
            <option key={contract.id} value={contract.id}>{contract.name}</option>
          ))}
        </select>
      </div>

      {selectedContractId && contractSummary && (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-700">Tipo de SUDS</th>
                {Object.keys(activityNames).map(category => (
                  <th key={category} className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-700" colSpan={(activityNames[category] || []).length}>
                    {category}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="py-2 px-4 border-b text-left text-xs font-medium text-gray-600"></th>
                {Object.keys(activityNames).map(category => (
                  (activityNames[category] || []).map(activityName => (
                    <th key={activityName} className="py-2 px-4 border-b text-left text-xs font-medium text-gray-600">
                      {activityName}
                    </th>
                  ))
                ))}
              </tr>
            </thead>
            <tbody>
              {contractSummary.map(sudsSummary => (
                <tr key={sudsSummary.sudsId} className="hover:bg-gray-50">
                  <td className="py-2 px-4 border-b text-sm font-medium text-gray-800">{sudsSummary.sudsName}</td>
                  {Object.keys(activityNames).map(category => (
                    sudsSummary.activities[category].map(activity => (
                      <td key={`${sudsSummary.sudsId}-${category}-${activity.name}`} className="py-2 px-4 border-b text-center text-sm">
                        {activity.completed ? (
                          <span className="text-green-600 font-bold" title={`Completada el: ${activity.date}\nDetalles: ${activity.details}`}>✓</span>
                        ) : (
                          <span className="text-red-600 font-bold" title="Pendiente">✗</span>
                        )}
                      </td>
                    ))
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!selectedContractId && (
        <p className="text-center text-gray-500">Selecciona un contrato para ver el resumen.</p>
      )}
      {selectedContractId && !contractSummary?.length && !loading && (
        <p className="text-center text-gray-500">No hay datos de SUDS para este contrato.</p>
      )}
    </div>
  );
};

// --- Tab 6: Resumen Visual ---
const VisualSummaryTab = () => {
  const { db, appId, showCustomModal } = useAppContext();
  const [maintenanceActivities, setMaintenanceActivities] = useState([]);
  const [sudsTypes, setSudsTypes] = useState([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1); // Month is 1-indexed
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState('bar'); // 'bar' or 'pie'

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, name: new Date(0, i).toLocaleString('es-ES', { month: 'long' }) }));

  useEffect(() => {
    if (!db || !appId) {
      setLoading(false);
      return;
    }

    const unsubscribeActivities = onSnapshot(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`), (snapshot) => {
      setMaintenanceActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching maintenance activities for visual summary:", error);
      showCustomModal(`Error al cargar actividades: ${error.message}`);
      setLoading(false);
    });

    const unsubscribeSuds = onSnapshot(collection(db, `artifacts/${appId}/public/data/sudsTypes`), (snapshot) => {
      setSudsTypes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error fetching SUDS types for visual summary:", error);
      showCustomModal(`Error al cargar tipos de SUDS: ${error.message}`);
    });

    return () => {
      unsubscribeActivities();
      unsubscribeSuds();
    };
  }, [db, appId, showCustomModal]);

  const getChartData = () => {
    // Filter activities by selected year and month
    const filteredActivities = maintenanceActivities.filter(activity => {
      const activityDate = new Date(activity.date);
      return activityDate.getFullYear() === selectedYear &&
             (selectedMonth === 0 || activityDate.getMonth() + 1 === selectedMonth); // 0 for all months
    });

    // Group by SUDS Type
    const sudsTypeCounts = {};
    filteredActivities.forEach(activity => {
      const suds = sudsTypes.find(s => s.id === activity.sudsTypeId);
      const sudsName = suds ? suds.name : 'SUDS Desconocido';
      sudsTypeCounts[sudsName] = (sudsTypeCounts[sudsName] || 0) + 1;
    });

    return Object.keys(sudsTypeCounts).map(name => ({
      name,
      value: sudsTypeCounts[name]
    }));
  };

  const chartData = getChartData();
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#83A6ED', '#8DD1E1', '#82CA9D', '#A4DE6C'];

  if (loading) {
    return <div className="text-center text-gray-600">Cargando resumen visual...</div>;
  }
   if (!db) {
    return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible. Verifica la configuración de Firebase.</div>;
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">Resumen Visual de Actividades</h2>

      {/* Filtros de Fecha */}
      <div className="mb-6 p-4 bg-gray-100 rounded-lg border border-gray-200 flex flex-wrap gap-4 items-center">
        <div>
          <label htmlFor="yearSelect" className="block text-sm font-medium text-gray-700 mb-1">Año:</label>
          <select
            id="yearSelect"
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            {years.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="monthSelect" className="block text-sm font-medium text-gray-700 mb-1">Mes:</label>
          <select
            id="monthSelect"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value={0}>Todos los meses</option>
            {months.map(month => (
              <option key={month.value} value={month.value}>{month.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="chartTypeSelect" className="block text-sm font-medium text-gray-700 mb-1">Tipo de Gráfico:</label>
          <select
            id="chartTypeSelect"
            value={chartType}
            onChange={(e) => setChartType(e.target.value)}
            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="bar">Barras</option>
            <option value="pie">Tarta</option>
          </select>
        </div>
      </div>

      {/* Gráfico */}
      <div className="w-full h-96 flex items-center justify-center bg-gray-50 rounded-lg shadow-inner">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' ? (
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" interval={0} angle={-30} textAnchor="end" height={60} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#8884d8" />
              </BarChart>
            ) : (
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            )}
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-500">No hay datos para mostrar el gráfico con los filtros seleccionados.</p>
        )}
      </div>
    </div>
  );
};

export default App;
