import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
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

// Initialize Firebase App
// Check if all necessary Firebase config values are present
const isFirebaseConfigComplete = firebaseConfig.apiKey &&
                               firebaseConfig.authDomain &&
                               firebaseConfig.projectId &&
                               firebaseConfig.appId;
// Define la configuración de Firebase usando las variables de entorno de Vercel
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  // Aunque FIRESTORE_APP_ID no suele ir en el objeto firebaseConfig,
  // si tu código lo usa en initializeApp, mantenlo. Si no, no es necesario aquí.
  // firestoreAppId: process.env.REACT_APP_FIRESTORE_APP_ID,
};

// Variable para verificar si la configuración de Firebase es completa
const isFirebaseConfigComplete = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);
let firebaseApp;
let db;
let auth;

if (isFirebaseConfigComplete) {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
    console.log("Firebase initialized successfully with environment variables.");
    // You might want to set a log level for Firebase in production
    // import { setLogLevel } from "firebase/app";
    // setLogLevel('silent'); // or 'error'
  } catch (error) {
    console.error("Error initializing Firebase with environment variables:", error);
    // Display a user-friendly message if Firebase fails to initialize
  }
} else {
  console.warn("Firebase configuration is incomplete. Check your environment variables (REACT_APP_FIREBASE_...). Using fallback for Canvas if __firebase_config is present.");
  // Fallback for Canvas environment (if environment variables are not set)
  // This part allows the app to still run in the Canvas environment if needed.
  let canvasFirebaseConfig = {};
  if (typeof __firebase_config !== 'undefined') {
    try {
      canvasFirebaseConfig = JSON.parse(__firebase_config);
      if (canvasFirebaseConfig.apiKey) { // Basic check
        firebaseApp = initializeApp(canvasFirebaseConfig);
        db = getFirestore(firebaseApp);
        auth = getAuth(firebaseApp);
        console.log("Firebase initialized successfully with __firebase_config (Canvas fallback).");
      } else {
        console.error("Fallback __firebase_config is invalid.");
      }
    } catch (e) {
      console.error("Error parsing __firebase_config (Canvas fallback):", e);
    }
  } else {
    console.error("Firebase configuration is missing and no Canvas fallback available. App functionality will be limited.");
  }
}


// --- Role Definitions (kept for reference, but functionality is now open) ---
const ROLES = {
  MAIN_EDITOR: 'editor_principal',
  EDITOR: 'editor',
  PROPOSAL: 'propuesta',
  VALIDATOR: 'validador',
};

// --- Helper function for custom modal (instead of alert/confirm) ---
const CustomModal = ({ message, onConfirm, onCancel, showCancel = false }) => {
  if (!message) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full text-center">
        <p className="text-lg font-semibold mb-4">{message}</p>
        <div className="flex justify-center space-x-4">
          {showCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors"
            >
              Cancelar
            </button>
          )}
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Tab Button Component ---
const TabButton = ({ label, tabId, activeTab, setActiveTab }) => (
  <button
    onClick={() => setActiveTab(tabId)}
    className={`px-4 py-2 rounded-md transition-all duration-200 ease-in-out
      ${activeTab === tabId
        ? 'bg-blue-700 text-white shadow-lg'
        : 'bg-gray-200 text-gray-700 hover:bg-blue-100 hover:text-blue-700'
      }
      text-sm md:text-base font-medium whitespace-nowrap`}
  >
    {label}
  </button>
);


// --- Main App Component ---
const App = () => {
  const [activeTab, setActiveTab] = useState('sudsTypes');
  const [currentUser, setCurrentUser] = useState(null);
  const [userId, setUserId] = useState('');
  const [userRole, setUserRole] = useState(ROLES.MAIN_EDITOR); // Everyone is now a Main Editor
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalConfirmAction, setModalConfirmAction] = useState(null);
  const [showModalCancel, setShowModalCancel] = useState(false);
  const fileInputRef = useRef(null); // Ref for the file input
  const [firebaseUnavailable, setFirebaseUnavailable] = useState(false); // State to track Firebase availability

  // Role assignment is now simplified: everyone is a main editor
  const assignRole = (uid) => {
    return ROLES.MAIN_EDITOR;
  };

  useEffect(() => {
    if (!auth) { // If Firebase auth is not initialized
      console.error("Firebase Auth is not available. Authentication cannot proceed.");
      setFirebaseUnavailable(true);
      setIsAuthReady(true); // Set auth ready to stop loading, but show error
      return;
    }
    setFirebaseUnavailable(false);

    // Firebase Authentication
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        setUserId(user.uid);
        setUserRole(assignRole(user.uid));
        console.log("Authenticated user:", user.uid, "Role:", assignRole(user.uid));
      } else {
        // For deployed app, rely on anonymous sign-in if no user.
        // The __initial_auth_token is Canvas-specific.
        try {
          await signInAnonymously(auth);
          console.log("Signed in anonymously on deployed app.");
        } catch (error) {
          console.error("Error during Firebase anonymous sign-in:", error);
          setModalMessage(`Error al iniciar sesión anónimamente: ${error.message}`);
        }
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []); // Empty dependency array, runs once

  const showCustomModal = (message, onConfirm, showCancel = false, onCancel = null) => {
    setModalMessage(message);
    setShowModalCancel(showCancel);
    setModalConfirmAction(() => ({ confirm: onConfirm, cancel: onCancel }));
  };

  const handleModalConfirm = () => {
    if (modalConfirmAction && modalConfirmAction.confirm) {
      modalConfirmAction.confirm();
    }
    setModalMessage('');
    setModalConfirmAction(null);
    setShowModalCancel(false);
  };

  const handleModalCancel = () => {
    if (modalConfirmAction && modalConfirmAction.cancel) {
      modalConfirmAction.cancel();
    }
    setModalMessage('');
    setModalConfirmAction(null);
    setShowModalCancel(false);
  };

  const handleExportData = async () => {
    if (!db) {
      showCustomModal("La base de datos no está disponible. No se pueden descargar datos.");
      return;
    }
    showCustomModal("Preparando datos para descargar...", () => {});
    try {
      const collectionsToExport = ['sudsTypes', 'contracts', 'maintenanceActivities'];
      const appSettingsDocs = ['maintenanceCategories', 'definedActivityNames'];
      const exportedData = {};

      for (const collectionName of collectionsToExport) {
        const snapshot = await getDocs(collection(db, `artifacts/${appIdentifier}/public/data/${collectionName}`));
        exportedData[collectionName] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }

      exportedData.appSettings = {};
      for (const docName of appSettingsDocs) {
        const docSnap = await getDoc(doc(db, `artifacts/${appIdentifier}/public/data/appSettings`, docName));
        if (docSnap.exists()) {
          exportedData.appSettings[docName] = docSnap.data();
        }
      }

      const dataStr = JSON.stringify(exportedData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `suds_maintenance_data_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showCustomModal("Datos descargados con éxito.", () => {});
    } catch (error) {
      console.error("Error exporting data:", error);
      showCustomModal(`Error al descargar datos: ${error.message}`, () => {});
    }
  };

  const handleImportData = () => {
    if (!db) {
      showCustomModal("La base de datos no está disponible. No se pueden cargar datos.");
      return;
    }
    fileInputRef.current.click();
  };

  const processImportFile = async (event) => {
    if (!db) {
      showCustomModal("La base de datos no está disponible. No se pueden procesar los datos.");
      return;
    }
    const file = event.target.files[0];
    if (!file) {
      showCustomModal("No se seleccionó ningún archivo.");
      return;
    }

    showCustomModal("¿Estás seguro de que quieres cargar estos datos? Esto REEMPLAZARÁ toda la información existente en la aplicación.",
      async () => {
        try {
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const importedData = JSON.parse(e.target.result);

              const collectionsToImport = ['sudsTypes', 'contracts', 'maintenanceActivities'];
              const appSettingsDocs = ['maintenanceCategories', 'definedActivityNames'];

              for (const collectionName of collectionsToImport) {
                const q = collection(db, `artifacts/${appIdentifier}/public/data/${collectionName}`);
                const snapshot = await getDocs(q);
                const batch = writeBatch(db);
                snapshot.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
                console.log(`Cleared collection: ${collectionName}`);
              }

              for (const collectionName of collectionsToImport) {
                if (importedData[collectionName] && Array.isArray(importedData[collectionName])) {
                  const batch = writeBatch(db);
                  importedData[collectionName].forEach(item => {
                    const docRef = doc(db, `artifacts/${appIdentifier}/public/data/${collectionName}`, item.id);
                    batch.set(docRef, item, { merge: true });
                  });
                  await batch.commit();
                  console.log(`Imported data into collection: ${collectionName}`);
                }
              }

              if (importedData.appSettings) {
                for (const docName of appSettingsDocs) {
                  if (importedData.appSettings[docName]) {
                    await setDoc(doc(db, `artifacts/${appIdentifier}/public/data/appSettings`, docName), importedData.appSettings[docName], { merge: true });
                    console.log(`Imported app setting: ${docName}`);
                  }
                }
              }

              showCustomModal("Datos cargados con éxito. La aplicación se actualizará.", () => {
                window.location.reload();
              });
            } catch (parseError) {
              console.error("Error parsing imported file:", parseError);
              showCustomModal(`Error al procesar el archivo: ${parseError.message}`);
            }
          };
          reader.readAsText(file);
        } catch (error) {
          console.error("Error importing data:", error);
          showCustomModal(`Error al cargar datos: ${error.message}`);
        }
      },
      true
    );
    event.target.value = '';
  };

  const handleMoveSudsType = async (sudsId, direction, currentSudsTypes) => {
    if (!db) {
      showCustomModal("La base de datos no está disponible.");
      return;
    }
    const currentIndex = currentSudsTypes.findIndex(s => s.id === sudsId);
    if (currentIndex === -1) return;

    const newSudsTypesOrder = [...currentSudsTypes];

    if (direction === 'up' && currentIndex > 0) {
      [newSudsTypesOrder[currentIndex - 1], newSudsTypesOrder[currentIndex]] = [newSudsTypesOrder[currentIndex], newSudsTypesOrder[currentIndex - 1]];
    } else if (direction === 'down' && currentIndex < newSudsTypesOrder.length - 1) {
      [newSudsTypesOrder[currentIndex + 1], newSudsTypesOrder[currentIndex]] = [newSudsTypesOrder[currentIndex], newSudsTypesOrder[currentIndex + 1]];
    } else {
      return;
    }

    const batch = writeBatch(db);
    newSudsTypesOrder.forEach((suds, index) => {
      if (suds.order !== index || suds.order === undefined) {
        batch.update(doc(db, `artifacts/${appIdentifier}/public/data/sudsTypes`, suds.id), { order: index });
      }
    });

    try {
      await batch.commit();
    } catch (error) {
      console.error("Error moving SUDS type:", error);
      showCustomModal(`Error al mover el tipo de SUDS: ${error.message}`);
    }
  };

  const handleMoveActivityColumn = async (category, activityName, direction, currentDefinedActivityNames) => {
    if (!db) {
      showCustomModal("La base de datos no está disponible.");
      return;
    }
    const currentCategoryActivities = currentDefinedActivityNames[category] || [];
    const currentIndex = currentCategoryActivities.indexOf(activityName);
    const newActivities = [...currentCategoryActivities];

    if (direction === 'left' && currentIndex > 0) {
      [newActivities[currentIndex - 1], newActivities[currentIndex]] = [newActivities[currentIndex], newActivities[currentIndex - 1]];
    } else if (direction === 'right' && currentIndex < newActivities.length - 1) {
      [newActivities[currentIndex + 1], newActivities[currentIndex]] = [newActivities[currentIndex], newActivities[currentIndex + 1]];
    } else {
      return;
    }

    const updatedDefinedActivities = {
      ...currentDefinedActivityNames,
      [category]: newActivities
    };

    try {
      await setDoc(doc(db, `artifacts/${appIdentifier}/public/data/appSettings`, 'definedActivityNames'), updatedDefinedActivities);
    } catch (error) {
      console.error("Error moving activity column:", error);
      showCustomModal(`Error al mover la actividad: ${error.message}`);
    }
  };


  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 font-inter">
        <div className="text-xl text-gray-700">Cargando aplicación...</div>
      </div>
    );
  }

  if (firebaseUnavailable) {
     return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-red-100 font-inter p-4">
        <div className="text-2xl font-bold text-red-700 mb-4">Error de Configuración</div>
        <p className="text-red-600 text-center mb-2">No se pudo inicializar Firebase.</p>
        <p className="text-gray-700 text-center">
          Por favor, asegúrate de que las variables de entorno de Firebase (REACT_APP_FIREBASE_...) estén correctamente configuradas en tu plataforma de despliegue.
        </p>
        <p className="text-gray-700 text-center mt-2">
          Si estás desarrollando localmente, verifica tu archivo `.env` o la configuración de tu proyecto.
        </p>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ db, auth, userId, userRole, appId: appIdentifier, showCustomModal, handleMoveSudsType, handleMoveActivityColumn }}>
      <div className="min-h-screen bg-gray-100 font-inter flex flex-col">
        <CustomModal
          message={modalMessage}
          onConfirm={handleModalConfirm}
          onCancel={handleModalCancel}
          showCancel={showModalCancel}
        />

        <header className="bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-lg p-4 md:p-6">
          <div className="container mx-auto flex flex-col md:flex-row justify-between items-center">
            <h1 className="text-2xl md:text-3xl font-bold mb-2 md:mb-0">Gestión del Mantenimiento de SUDS en Madrid</h1>
            <div className="flex items-center space-x-4 mb-2 md:mb-0">
              <img
                src="https://diario.madrid.es/wp-content/uploads/2016/06/foto-marca-diario.png"
                alt="[Image of Logo Ayuntamiento de Madrid]"
                className="h-10 w-10 object-contain rounded-md"
                onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/40x40/cccccc/ffffff?text=Ayto`; }}
              />
              <img
                src="https://image.pitchbook.com/rdjct1ADAytcUTYGiOZycNNZceZ1663601340509_200x200"
                alt="[Image of Logo Madrid Nuevo Norte]"
                className="h-10 w-10 object-contain rounded-md"
                onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/40x40/cccccc/ffffff?text=MNN`; }}
              />
            </div>
            <div className="flex flex-col items-center md:items-end text-sm md:text-base">
              <span className="text-xs italic text-gray-200">Área Demostradora de Acción Climática de Madrid Nuevo Norte.</span>
              <span className="text-xs italic text-gray-200">GT de Gestión innovadora del Agua.</span>
              <span className="mt-2">Usuario: <span className="font-semibold">{userId || 'No autenticado'}</span> | Rol: <span className="font-semibold">{userRole}</span></span>
            </div>
          </div>
        </header>

        <nav className="bg-white shadow-md py-3 px-4">
          <div className="container mx-auto flex flex-wrap justify-center md:justify-start gap-2 md:gap-4">
            <TabButton label="Tipos de SUDS" tabId="sudsTypes" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton label="Contratos de mantenimiento" tabId="contracts" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton label="Definición de Actividades por SUDS" tabId="sudsActivityDefinition" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton label="Detalle de Actividades por SUDS" tabId="sudsActivityDetails" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton label="Resumen por contrato y validación" tabId="summary" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton label="Resumen Visual" tabId="visualSummary" activeTab={activeTab} setActiveTab={setActiveTab} />
          </div>
        </nav>

        <div className="bg-gray-200 p-3 flex flex-wrap justify-center gap-4 shadow-inner">
          <button
            onClick={handleExportData}
            className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors shadow-md text-sm"
          >
            Descargar Datos
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={processImportFile}
            accept=".json"
            className="hidden"
          />
          <button
            onClick={handleImportData}
            className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors shadow-md text-sm"
          >
            Subir Datos
          </button>
        </div>

        <main className="flex-grow container mx-auto p-4 md:p-6">
          {activeTab === 'sudsTypes' && <SudsTypesTab />}
          {activeTab === 'contracts' && <ContractsTab />}
          {activeTab === 'sudsActivityDefinition' && <SudsActivityDefinitionTab />}
          {activeTab === 'sudsActivityDetails' && <SudsActivityDetailsTab />}
          {activeTab === 'summary' && <SummaryTab />}
          {activeTab === 'visualSummary' && <VisualSummaryTab />}
        </main>

        <footer className="bg-gray-800 text-white text-center p-4 text-sm">
          © {new Date().getFullYear()} Gestión del Mantenimiento de SUDS en Madrid. Todos los derechos reservados.
        </footer>
      </div>
    </AppContext.Provider>
  );
};

// --- Tab 1: Tipos de SUDS ---
const SudsTypesTab = () => {
  const { db, userId, userRole, appId, showCustomModal } = useAppContext(); // appId here is now appIdentifier
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
  const canEdit = true;

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
      const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

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
  });


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
                placeholder="https://placehold.co/300x200/cccccc/ffffff?text=SUDS"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Introduce una URL de imagen. Solo se admite una imagen por ahora.</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Ubicación:</label>
              <div className="flex flex-wrap gap-2">
                {locationTypeOptions.map(option => (
                  <button
                    key={option.id}
                    onClick={() => handleToggleLocationType(option.id)}
                    className={`flex items-center justify-center p-2 rounded-md border transition-all duration-200
                      ${newSudsLocationTypes.includes(option.id)
                        ? 'bg-blue-500 text-white border-blue-600 shadow-md'
                        : 'bg-gray-200 text-gray-700 border-gray-300 hover:bg-blue-100'
                      }`}
                    title={option.name}
                  >
                    {option.icon.startsWith('http') ? (
                      <img src={option.icon} alt={option.name} className="h-6 w-6 object-contain" onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/24x24/cccccc/ffffff?text=?`; }} />
                    ) : (
                      <span className="text-xl">{option.icon}</span>
                    )}
                    <span className="ml-2 text-sm">{option.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <button
              onClick={handleAddOrUpdateSuds}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors shadow-md"
            >
              {editingSudsId ? 'Guardar Cambios' : 'Añadir SUDS'}
            </button>
            {editingSudsId && (
              <button
                onClick={() => {
                  setNewSudsName('');
                  setNewSudsDescription('');
                  setNewSudsImageUrl('');
                  setNewSudsLocationTypes([]);
                  setEditingSudsId(null);
                  setShowAddSudsForm(false);
                }}
                className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors shadow-md"
              >
                Cancelar Edición
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mb-8 p-4 bg-gray-100 rounded-lg border border-gray-200">
        <h3 className="text-xl font-semibold text-gray-800 mb-3">Filtrar Tipos de SUDS</h3>
        <div className="flex flex-wrap gap-2">
          {locationTypeOptions.map(option => (
            <button
              key={`filter-${option.id}`}
              onClick={() => handleToggleFilterLocationType(option.id)}
              className={`flex items-center justify-center p-2 rounded-md border transition-all duration-200
                ${filterLocationTypes.includes(option.id)
                  ? 'bg-green-500 text-white border-green-600 shadow-md'
                  : 'bg-gray-200 text-gray-700 border-gray-300 hover:bg-green-100'
                }`}
              title={`Filtrar por: ${option.name}`}
            >
              {option.icon.startsWith('http') ? (
                <img src={option.icon} alt={option.name} className="h-6 w-6 object-contain" onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/24x24/cccccc/ffffff?text=?`; }} />
              ) : (
                <span className="text-xl">{option.icon}</span>
              )}
              <span className="ml-2 text-sm">{option.name}</span>
            </button>
          ))}
          {filterLocationTypes.length > 0 && (
            <button
              onClick={() => setFilterLocationTypes([])}
              className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors text-sm shadow-md"
            >
              Limpiar Filtros
            </button>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-xl font-semibold text-gray-800 mb-4">Tipos de SUDS Existentes</h3>
        {filteredSudsTypes.length === 0 ? (
          <p className="text-gray-600">No hay tipos de SUDS definidos aún o no coinciden con los filtros. {canEdit && '¡Añade uno!'}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredSudsTypes.map((suds) => (
              <div key={suds.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4 shadow-sm flex flex-col">
                {suds.imageUrls && suds.imageUrls.length > 0 && (
                  <img
                    src={suds.imageUrls[0]}
                    alt={`[Image of ${suds.name}]`}
                    className="w-full h-40 object-cover rounded-md mb-4 border border-gray-300"
                    onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/300x200/cccccc/ffffff?text=SUDS`; }}
                  />
                )}
                <h4 className="text-lg font-bold text-gray-900 mb-2">{suds.name}</h4>
                <p className="text-gray-700 text-sm flex-grow mb-4">{suds.description}</p>
                {suds.locationTypes && suds.locationTypes.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {locationTypeOptions.map(option =>
                      suds.locationTypes.includes(option.id) && (
                        <span key={option.id} className="flex items-center text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                          {option.icon.startsWith('http') ? (
                            <img src={option.icon} alt={option.name} className="h-4 w-4 object-contain mr-1" onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/16x16/cccccc/ffffff?text=?`; }} />
                          ) : (
                            <span className="mr-1">{option.icon}</span>
                          )}
                          {option.name}
                        </span>
                      )
                    )}
                  </div>
                )}
                {canEdit && (
                  <div className="flex justify-end space-x-2 mt-auto">
                    <button
                      onClick={() => handleEditSuds(suds)}
                      className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteSuds(suds.id)}
                      className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Tab 2: Contratos de mantenimiento ---
const ContractsTab = () => {
  const { db, userId, userRole, appId, showCustomModal } = useAppContext(); // appId here is now appIdentifier
  const [contracts, setContracts] = useState([]);
  const [newContractName, setNewContractName] = useState('');
  const [newContractSummary, setNewContractSummary] = useState('');
  const [newContractResponsible, setNewContractResponsible] = useState('');
  const [newContractLogoUrl, setNewContractLogoUrl] = useState('');
  const [editingContractId, setEditingContractId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddContractForm, setShowAddContractForm] = useState(false);
  const canEdit = true;

  useEffect(() => {
    if (!db || !appId) { // appId here is appIdentifier from context
      setLoading(false);
      return;
    }

    const q = collection(db, `artifacts/${appId}/public/data/contracts`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const contractsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setContracts(contractsData);
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
    if (!newContractName.trim() || !newContractSummary.trim() || !newContractResponsible.trim()) {
      showCustomModal("Por favor, rellena todos los campos del contrato.");
      return;
    }

    try {
      const contractData = {
        name: newContractName.trim(),
        summary: newContractSummary.trim(),
        responsible: newContractResponsible.trim(),
        logoUrl: newContractLogoUrl.trim(),
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
      setNewContractSummary('');
      setNewContractResponsible('');
      setNewContractLogoUrl('');
      setEditingContractId(null);
      setShowAddContractForm(false);
    } catch (error) {
      console.error("Error adding/updating contract:", error);
      showCustomModal(`Error al guardar contrato: ${error.message}`);
    }
  };

  const handleEditContract = (contract) => {
    setNewContractName(contract.name);
    setNewContractSummary(contract.summary);
    setNewContractResponsible(contract.responsible);
    setNewContractLogoUrl(contract.logoUrl || '');
    setEditingContractId(contract.id);
    setShowAddContractForm(true);
  };

  const handleDeleteContract = async (id) => {
    if (!db) {
      showCustomModal("La base de datos no está disponible.");
      return;
    }
    showCustomModal(
      "¿Estás seguro de que quieres eliminar este contrato? Esto también afectará a las actividades asociadas.",
      async () => {
        try {
          await deleteDoc(doc(db, `artifacts/${appId}/public/data/contracts`, id));
          showCustomModal("Contrato eliminado con éxito.");
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
        Contratos de mantenimiento
        {canEdit && (
          <button
            onClick={() => setShowAddContractForm(!showAddContractForm)}
            className="p-2 bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors shadow-md text-xl leading-none"
            title={showAddContractForm ? "Ocultar formulario" : "Añadir nuevo contrato"}
          >
            {showAddContractForm ? '−' : '+'}
          </button>
        )}
      </h2>

      {canEdit && showAddContractForm && (
        <div className="mb-8 p-6 bg-green-50 rounded-lg border border-green-200">
          <h3 className="text-xl font-semibold text-green-800 mb-4">{editingContractId ? 'Editar Contrato' : 'Añadir Nuevo Contrato'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="contractName" className="block text-sm font-medium text-gray-700 mb-1">Nombre del Contrato</label>
              <input
                type="text"
                id="contractName"
                value={newContractName}
                onChange={(e) => setNewContractName(e.target.value)}
                placeholder="Ej: Conservación del viario"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <div>
              <label htmlFor="contractResponsible" className="block text-sm font-medium text-gray-700 mb-1">Responsable</label>
              <input
                type="text"
                id="contractResponsible"
                value={newContractResponsible}
                onChange={(e) => setNewContractResponsible(e.target.value)}
                placeholder="Nombre del responsable o ID de usuario"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="contractSummary" className="block text-sm font-medium text-gray-700 mb-1">Resumen</label>
              <textarea
                id="contractSummary"
                value={newContractSummary}
                onChange={(e) => setNewContractSummary(e.target.value)}
                placeholder="Resumen del contrato, alcance, etc."
                rows="3"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              ></textarea>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="contractLogoUrl" className="block text-sm font-medium text-gray-700 mb-1">URL del Logo (opcional)</label>
              <input
                type="url"
                id="contractLogoUrl"
                value={newContractLogoUrl}
                onChange={(e) => setNewContractLogoUrl(e.target.value)}
                placeholder="Ej: https://ejemplo.com/logo.png"
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              />
              <p className="text-xs text-gray-500 mt-1">Introduce una URL de imagen para el logo del contrato.</p>
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <button
              onClick={handleAddOrUpdateContract}
              className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors shadow-md"
            >
              {editingContractId ? 'Guardar Cambios' : 'Añadir Contrato'}
            </button>
            {editingContractId && (
              <button
                onClick={() => {
                  setNewContractName('');
                  setNewContractSummary('');
                  setNewContractResponsible('');
                  setNewContractLogoUrl('');
                  setEditingContractId(null);
                  setShowAddContractForm(false);
                }}
                className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors shadow-md"
              >
                Cancelar Edición
              </button>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xl font-semibold text-gray-800 mb-4">Contratos Existentes</h3>
        {contracts.length === 0 ? (
          <p className="text-gray-600">No hay contratos definidos aún. {canEdit && '¡Añade uno!'}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
            {contracts.map((contract) => (
              <div key={contract.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4 shadow-sm flex flex-col">
                <h4 className="text-lg font-bold text-gray-900 mb-2">{contract.name}</h4>
                {contract.logoUrl && (
                  <img
                    src={contract.logoUrl}
                    alt={`[Logo of ${contract.name}]`}
                    className="w-16 h-16 object-contain rounded-md mb-2"
                    onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/64x64/cccccc/ffffff?text=Logo`; }}
                  />
                )}
                <p className="text-gray-700 text-sm mb-2"><span className="font-semibold">Responsable:</span> {contract.responsible}</p>
                <p className="text-gray-700 text-sm flex-grow mb-4">{contract.summary}</p>
                {canEdit && (
                  <div className="flex justify-end space-x-2 mt-auto">
                    <button
                      onClick={() => handleEditContract(contract)}
                      className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteContract(contract.id)}
                      className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Helper to generate allActivitiesFlat
const generateAllActivitiesFlat = (sudsTypes, categories, definedActivityNames) => {
  const allPossibleActivities = [];
  sudsTypes.forEach(suds => {
    categories.forEach(category => {
      (definedActivityNames[category] || []).forEach(activityName => {
        allPossibleActivities.push({
          id: `${suds.id}-${category}-${activityName}`, // Ensure consistent ID generation
          sudsId: suds.id,
          sudsName: suds.name,
          category: category,
          activityName: activityName,
        });
      });
    });
  });
  return allPossibleActivities;
};

// --- New Tab 3: Definición de Actividades por SUDS ---
const SudsActivityDefinitionTab = () => {
  const { db, userId, appId, showCustomModal, handleMoveSudsType, handleMoveActivityColumn } = useAppContext(); // appId here is now appIdentifier
  const [sudsTypes, setSudsTypes] = useState([]);
  const [maintenanceActivities, setMaintenanceActivities] = useState([]);
  const [categories, setCategories] = useState(['Limpieza', 'Vegetación', 'Estructura', 'Hidráulica', 'Otros']);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newActivityInput, setNewActivityInput] = useState('');
  const [showAddActivityInput, setShowAddActivityInput] = useState({});
  const [definedActivityNames, setDefinedActivityNames] = useState({});
  const [loading, setLoading] = useState(true);

  const [editingActivityNameId, setEditingActivityNameId] = useState(null);
  const [editingActivityNameValue, setEditingActivityNameValue] = useState('');
  const [editingActivityNameCategory, setEditingActivityNameCategory] = useState('');

  const [showDependenciesModal, setShowDependenciesModal] = useState(false);
  const [currentActivityForDependencies, setCurrentActivityForDependencies] = useState(null);
  const [selectedDependencies, setSelectedDependencies] = useState([]);

  const canEdit = true;

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

    const fetchInitialData = async () => {
      try {
        const sudsRef = collection(db, `artifacts/${appId}/public/data/sudsTypes`);
        const unsubscribeSuds = onSnapshot(sudsRef, (snapshot) => {
          const fetchedSudsTypes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          const sudsTypesWithOrder = fetchedSudsTypes.map((suds, index) => ({
            ...suds,
            order: suds.order === undefined ? index : suds.order,
          }));
          setSudsTypes(sudsTypesWithOrder.sort((a, b) => (a.order || 0) - (b.order || 0)));
          setLoading(false);
        }, (error) => {
          console.error("Error fetching SUDS types:", error);
          showCustomModal(`Error al cargar tipos de SUDS: ${error.message}`);
          setLoading(false);
        });

        const activitiesRef = collection(db, `artifacts/${appId}/public/data/maintenanceActivities`);
        const unsubscribeActivities = onSnapshot(activitiesRef, (snapshot) => {
          setMaintenanceActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }, (error) => console.error("Error fetching maintenance activities:", error));

        const categoriesRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories');
        const unsubscribeCategories = onSnapshot(categoriesRef, (docSnap) => {
          if (docSnap.exists() && docSnap.data().categories) setCategories(docSnap.data().categories);
        });

        const definedActivitiesRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames');
        const unsubscribeDefinedActivities = onSnapshot(definedActivitiesRef, (docSnap) => {
          if (docSnap.exists() && docSnap.data()) setDefinedActivityNames(docSnap.data());
          else setDefinedActivityNames({});
        });

        return () => {
          unsubscribeSuds();
          unsubscribeActivities();
          unsubscribeCategories();
          unsubscribeDefinedActivities();
        };

      } catch (error) {
        console.error("Error fetching initial data for activities tab:", error);
        showCustomModal(`Error al cargar datos iniciales: ${error.message}`);
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [db, appId, showCustomModal]);

  const handleToggleActivityApplies = async (sudsId, activityName, category) => {
    if (!db) return;
    const existingActivity = maintenanceActivities.find(
      (act) => act.sudsTypeId === sudsId && act.activityName === activityName && act.category === category
    );
    const newAppliesStatus = !existingActivity?.applies;
    const activityData = {
      sudsTypeId: sudsId,
      activityName: activityName,
      category: category,
      applies: newAppliesStatus,
      lastUpdatedBy: userId,
      timestamp: new Date(),
      ...(existingActivity ? {
        status: existingActivity.status || '',
        comment: existingActivity.comment || '',
        involvedContracts: existingActivity.involvedContracts || [],
        frequency: existingActivity.frequency || '',
        validationStatus: existingActivity.validationStatus || 'pendiente',
        validatorComment: existingActivity.validatorComment || '',
        validatedBy: existingActivity.validatedBy || '',
        dependentActivities: existingActivity.dependentActivities || [],
      } : {}),
    };
    try {
      if (existingActivity) {
        await updateDoc(doc(db, `artifacts/${appId}/public/data/maintenanceActivities`, existingActivity.id), activityData);
      } else {
        await addDoc(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`), activityData);
      }
    } catch (error) {
      console.error("Error updating activity applies status:", error);
      showCustomModal(`Error al guardar el estado de aplicación: ${error.message}`);
    }
  };

  const handleSaveNewActivity = async (category) => {
    if (!db) return;
    if (!newActivityInput.trim()) {
      showCustomModal("Por favor, introduce un nombre para la nueva actividad.");
      return;
    }
    const trimmedName = newActivityInput.trim().charAt(0).toUpperCase() + newActivityInput.trim().slice(1).toLowerCase();
    const currentCategoryActivities = definedActivityNames[category] || [];
    if (currentCategoryActivities.includes(trimmedName)) {
      showCustomModal(`La actividad "${trimmedName}" ya existe en la categoría "${category}".`);
      return;
    }
    const updatedDefinedActivities = {
      ...definedActivityNames,
      [category]: [...currentCategoryActivities, trimmedName]
    };
    try {
      await setDoc(doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames'), updatedDefinedActivities);
      showCustomModal(`Actividad "${trimmedName}" añadida a la categoría "${category}".`);
      setNewActivityInput('');
      setShowAddActivityInput({ ...showAddActivityInput, [category]: false });
    } catch (error) {
      console.error("Error adding new activity name:", error);
      showCustomModal(`Error al añadir la actividad: ${error.message}`);
    }
  };

  const handleDeleteActivityColumn = async (category, activityName) => {
    if (!db) return;
    showCustomModal(
      `¿Estás seguro de que quieres eliminar la actividad "${activityName}" de la categoría "${category}"? Esto eliminará todos los datos asociados a esta actividad.`,
      async () => {
        try {
          const currentCategoryActivities = definedActivityNames[category] || [];
          const updatedCategoryActivities = currentCategoryActivities.filter(name => name !== activityName);
          const updatedDefinedActivities = { ...definedActivityNames, [category]: updatedCategoryActivities };
          await setDoc(doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames'), updatedDefinedActivities);

          const q = query(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`),
            where("category", "==", category), where("activityName", "==", activityName));
          const snapshot = await getDocs(q);
          const batch = writeBatch(db);
          snapshot.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          showCustomModal(`Actividad "${activityName}" eliminada con éxito.`);
        } catch (error) {
          console.error("Error deleting activity column:", error);
          showCustomModal(`Error al eliminar la actividad: ${error.message}`);
        }
      }, true
    );
  };

  const handleAddCategory = async () => {
    if (!db) return;
    if (!newCategoryName.trim()) {
      showCustomModal("Por favor, introduce un nombre para la nueva categoría.");
      return;
    }
    const updatedCategories = [...categories, newCategoryName.trim()];
    try {
      await setDoc(doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories'), { categories: updatedCategories });
      setNewCategoryName('');
      showCustomModal("Nueva categoría añadida.");
    } catch (error) {
      console.error("Error adding new category:", error);
      showCustomModal(`Error al añadir categoría: ${error.message}`);
    }
  };

  const handleMoveCategory = async (categoryToMove, direction) => {
    if (!db) return;
    const currentIndex = categories.indexOf(categoryToMove);
    const newCategories = [...categories];
    if (direction === 'up' && currentIndex > 0) {
      [newCategories[currentIndex - 1], newCategories[currentIndex]] = [newCategories[currentIndex], newCategories[currentIndex - 1]];
    } else if (direction === 'down' && currentIndex < newCategories.length - 1) {
      [newCategories[currentIndex + 1], newCategories[currentIndex]] = [newCategories[currentIndex], newCategories[currentIndex + 1]];
    } else return;
    try {
      await setDoc(doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories'), { categories: newCategories });
      showCustomModal(`Categoría "${categoryToMove}" movida.`);
    } catch (error) {
      console.error("Error moving category:", error);
      showCustomModal(`Error al mover la categoría: ${error.message}`);
    }
  };

  const handleDeleteCategory = async (categoryToDelete) => {
    if (!db) return;
    const hasDefinedActivities = (definedActivityNames[categoryToDelete] && definedActivityNames[categoryToDelete].length > 0);
    const q = query(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`), where("category", "==", categoryToDelete));
    const activityDocs = await getDocs(q);
    const hasMaintenanceRecords = !activityDocs.empty;

    const confirmDelete = async () => {
      try {
        const updatedCategories = categories.filter(cat => cat !== categoryToDelete);
        await setDoc(doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories'), { categories: updatedCategories });
        const updatedDefinedActivities = { ...definedActivityNames };
        delete updatedDefinedActivities[categoryToDelete];
        await setDoc(doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames'), updatedDefinedActivities);
        const batch = writeBatch(db);
        activityDocs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        showCustomModal(`Categoría "${categoryToDelete}" y todos sus datos asociados eliminados con éxito.`);
      } catch (error) {
        console.error("Error deleting category:", error);
        showCustomModal(`Error al eliminar la categoría: ${error.message}`);
      }
    };

    if (hasDefinedActivities || hasMaintenanceRecords) {
      showCustomModal(
        `La categoría "${categoryToDelete}" contiene actividades o registros. ¿Seguro que quieres eliminarla PERMANENTEMENTE?`,
        confirmDelete, true
      );
    } else {
      showCustomModal(`¿Seguro que quieres eliminar la categoría "${categoryToDelete}"?`, confirmDelete, true);
    }
  };

  const handleEditActivityNameStart = (category, activityName) => {
    setEditingActivityNameCategory(category);
    setEditingActivityNameId(activityName);
    setEditingActivityNameValue(activityName);
  };

  const handleEditActivityNameSave = async () => {
    if (!db) return;
    if (!editingActivityNameValue.trim()) {
      showCustomModal("El nombre de la actividad no puede estar vacío.");
      return;
    }
    const trimmedNewName = editingActivityNameValue.trim().charAt(0).toUpperCase() + editingActivityNameValue.trim().slice(1).toLowerCase();
    if (trimmedNewName === editingActivityNameId) {
      setEditingActivityNameId(null); return;
    }
    const currentCategoryActivities = definedActivityNames[editingActivityNameCategory] || [];
    if (currentCategoryActivities.includes(trimmedNewName)) {
      showCustomModal(`La actividad "${trimmedNewName}" ya existe en la categoría "${editingActivityNameCategory}".`);
      return;
    }
    showCustomModal(
      `¿Renombrar "${editingActivityNameId}" a "${trimmedNewName}"? Esto actualizará todos los registros.`,
      async () => {
        try {
          const updatedCategoryActivities = currentCategoryActivities.map(name =>
            name === editingActivityNameId ? trimmedNewName : name
          );
          const updatedDefinedActivities = { ...definedActivityNames, [editingActivityNameCategory]: updatedCategoryActivities };
          await setDoc(doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames'), updatedDefinedActivities);

          const q = query(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`),
            where("category", "==", editingActivityNameCategory), where("activityName", "==", editingActivityNameId));
          const snapshot = await getDocs(q);
          const batch = writeBatch(db);
          snapshot.docs.forEach(docSnap => batch.update(docSnap.ref, { activityName: trimmedNewName }));
          await batch.commit();
          showCustomModal("Nombre de actividad actualizado.");
          setEditingActivityNameId(null);
        } catch (error) {
          console.error("Error renaming activity:", error);
          showCustomModal(`Error al renombrar: ${error.message}`);
          setEditingActivityNameId(null);
        }
      }, true, () => setEditingActivityNameId(null)
    );
  };

  const handleOpenDependenciesModal = (sudsId, activityName, category) => {
    const activity = maintenanceActivities.find(
      (act) => act.sudsTypeId === sudsId && act.activityName === activityName && act.category === category
    );
    const suds = sudsTypes.find(s => s.id === sudsId);
    setCurrentActivityForDependencies({ sudsId, sudsName: suds?.name, activityName, category, id: activity?.id });
    setSelectedDependencies(activity?.dependentActivities || []);
    setShowDependenciesModal(true);
  };

  const handleToggleDependency = (dependentActivityId) => {
    setSelectedDependencies(prev =>
      prev.includes(dependentActivityId)
        ? prev.filter(id => id !== dependentActivityId)
        : [...prev, dependentActivityId]
    );
  };

  const handleSaveDependencies = async () => {
    if (!db || !currentActivityForDependencies) return;
    const { sudsId, activityName, category, id } = currentActivityForDependencies;
    try {
      const batch = writeBatch(db);
      const primaryActivityRef = id ? doc(db, `artifacts/${appId}/public/data/maintenanceActivities`, id) : null;
      if (primaryActivityRef) {
        batch.update(primaryActivityRef, { dependentActivities: selectedDependencies, lastUpdatedBy: userId, timestamp: new Date() });
      } else {
        const newPrimaryActivityData = {
          sudsTypeId: sudsId, activityName, category, applies: true, dependentActivities: selectedDependencies,
          lastUpdatedBy: userId, timestamp: new Date(), status: '', comment: '', involvedContracts: [], frequency: '',
          validationStatus: 'pendiente', validatorComment: '', validatedBy: '',
        };
        // Need to generate a new doc ref for set, or use addDoc if ID is auto-generated
        const newDocRef = doc(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`)); // This creates a ref with a new ID
        batch.set(newDocRef, newPrimaryActivityData);
      }

      for (const depId of selectedDependencies) {
        const dependentActivity = maintenanceActivities.find(act => act.id === depId);
        const [depSudsId, depCategory, depActivityName] = depId.split('-'); // Assumes ID format

        if (dependentActivity && !dependentActivity.applies) {
          const depRef = doc(db, `artifacts/${appId}/public/data/maintenanceActivities`, depId);
          batch.update(depRef, { applies: true, lastUpdatedBy: userId, timestamp: new Date() });
        } else if (!dependentActivity && depSudsId && depCategory && depActivityName) {
            const newDependentActivityData = {
              sudsTypeId: depSudsId, activityName: depActivityName, category: depCategory, applies: true,
              dependentActivities: [], lastUpdatedBy: userId, timestamp: new Date(), status: '', comment: '',
              involvedContracts: [], frequency: '', validationStatus: 'pendiente', validatorComment: '', validatedBy: '',
            };
            const newDepDocRef = doc(collection(db, `artifacts/${appId}/public/data/maintenanceActivities`)); // New ID for this one too
            batch.set(newDepDocRef, newDependentActivityData);
        }
      }
      await batch.commit();
      showCustomModal("Dependencias guardadas.");
      setShowDependenciesModal(false);
      setCurrentActivityForDependencies(null);
      setSelectedDependencies([]);
    } catch (error) {
      console.error("Error saving dependencies:", error);
      showCustomModal(`Error al guardar dependencias: ${error.message}`);
    }
  };

  const activityNamesByCategory = categories.reduce((acc, cat) => {
    let names = definedActivityNames[cat] || [];
    maintenanceActivities
      .filter(act => act.category === cat && !names.includes(act.activityName))
      .forEach(act => names.push(act.activityName));
    acc[cat] = names; // Order is preserved from definedActivityNames
    return acc;
  }, {});

  const allActivitiesFlat = generateAllActivitiesFlat(sudsTypes, categories, definedActivityNames);

  if (loading) return <div className="text-center text-gray-600">Cargando datos de actividades...</div>;
  if (!db) return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible.</div>;

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">Definición de Actividades por SUDS</h2>
      {canEdit && (
        <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200 flex flex-col md:flex-row items-center gap-4">
          <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Nueva categoría" className="flex-grow p-2 border rounded-md"/>
          <button onClick={handleAddCategory} className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700">Añadir Categoría</button>
        </div>
      )}
      {categories.map((category, index) => (
        <div key={category} className="mb-10">
          <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center justify-between">
            <div className="flex items-center">
              <span>{category}</span>
              {canEdit && (
                <div className="ml-4 flex space-x-2">
                  <button onClick={() => handleMoveCategory(category, 'up')} disabled={index === 0} className="p-1 disabled:opacity-50">⬆️</button>
                  <button onClick={() => handleMoveCategory(category, 'down')} disabled={index === categories.length - 1} className="p-1 disabled:opacity-50">⬇️</button>
                  <button onClick={() => handleDeleteCategory(category)} className="p-1 text-red-500">🗑️</button>
                </div>
              )}
            </div>
            {canEdit && (
              <button onClick={() => setShowAddActivityInput(prev => ({ ...prev, [category]: !prev[category] }))} className="ml-4 px-4 py-2 bg-blue-500 text-white rounded-md text-sm">
                {showAddActivityInput[category] ? '−' : '+'} Añadir Actividad
              </button>
            )}
          </h3>
          {canEdit && showAddActivityInput[category] && (
            <div className="mb-4 p-4 bg-blue-50 rounded-lg border flex gap-4">
              <input type="text" value={newActivityInput} onChange={(e) => setNewActivityInput(e.target.value)} placeholder="Nombre nueva actividad" className="flex-grow p-2 border rounded-md"/>
              <button onClick={() => handleSaveNewActivity(category)} className="px-6 py-2 bg-blue-600 text-white rounded-md">Guardar Actividad</button>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border shadow-sm">
            <table className="min-w-full divide-y">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase sticky left-0 bg-gray-50 z-10">Tipo SUDS</th>
                  {activityNamesByCategory[category].map((activityName) => (
                    <th key={`${category}-${activityName}`} className="px-2 py-3 text-xs font-medium uppercase">
                      <div className="flex flex-col items-center">
                        <div className="flex items-center">
                          <button onClick={() => handleMoveActivityColumn(category, activityName, 'left', definedActivityNames)} disabled={activityNamesByCategory[category].indexOf(activityName) === 0} className="p-1 disabled:opacity-50">⬅️</button>
                          {editingActivityNameId === activityName && editingActivityNameCategory === category ? (
                            <input type="text" value={editingActivityNameValue} onChange={(e) => setEditingActivityNameValue(e.target.value)} onBlur={handleEditActivityNameSave} onKeyDown={(e) => e.key === 'Enter' && handleEditActivityNameSave()} className="w-24 p-1 border-2 border-blue-500 rounded-md text-xs text-center"/>
                          ) : (
                            <span onClick={() => handleEditActivityNameStart(category, activityName)} className="cursor-pointer hover:text-blue-700">{activityName}</span>
                          )}
                          <button onClick={() => handleMoveActivityColumn(category, activityName, 'right', definedActivityNames)} disabled={activityNamesByCategory[category].indexOf(activityName) === activityNamesByCategory[category].length - 1} className="p-1 disabled:opacity-50">➡️</button>
                        </div>
                        {canEdit && <button onClick={() => handleDeleteActivityColumn(category, activityName)} className="mt-1 text-red-500 text-xs">🗑️</button>}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y">
                {sudsTypes.map((suds, sudsIndex) => (
                  <tr key={suds.id}>
                    <td className="px-4 py-4 text-sm font-medium sticky left-0 bg-white z-10">
                      <div className="flex items-center">
                        <div className="flex flex-col mr-2">
                          <button onClick={() => handleMoveSudsType(suds.id, 'up', sudsTypes)} disabled={sudsIndex === 0} className="p-0.5 disabled:opacity-50">⬆️</button>
                          <button onClick={() => handleMoveSudsType(suds.id, 'down', sudsTypes)} disabled={sudsIndex === sudsTypes.length - 1} className="p-0.5 disabled:opacity-50">⬇️</button>
                        </div>
                        {suds.name}
                        {suds.locationTypes && suds.locationTypes.length > 0 && (
                          <div className="ml-2 flex gap-1">
                            {locationTypeOptions.map(option => suds.locationTypes.includes(option.id) && (
                              <span key={option.id} className="text-base" title={option.name}>
                                {option.icon.startsWith('http') ? <img src={option.icon} alt={option.name} className="h-4 w-4 object-contain"/> : <span>{option.icon}</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    {activityNamesByCategory[category].map((activityName) => {
                      const activity = maintenanceActivities.find(act => act.sudsTypeId === suds.id && act.activityName === activityName && act.category === category);
                      const applies = activity?.applies || false;
                      const hasDependencies = activity?.dependentActivities && activity.dependentActivities.length > 0;
                      return (
                        <td key={`${suds.id}-${activityName}`} className={`p-2 border ${applies ? 'bg-green-100' : 'bg-gray-100'}`}>
                          <div className="flex items-center justify-center flex-col">
                            <input type="checkbox" checked={applies} onChange={() => handleToggleActivityApplies(suds.id, activityName, category)} className="form-checkbox h-5 w-5"/>
                            {applies && (
                              <button onClick={() => handleOpenDependenciesModal(suds.id, activityName, category)} className={`mt-1 text-sm ${hasDependencies ? 'text-blue-600' : 'text-gray-600'}`} title={hasDependencies ? `Depende de: ${activity.dependentActivities.join(', ')}` : 'Sin dependencias'}>🔗</button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showDependenciesModal && currentActivityForDependencies && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full">
                <h3 className="text-xl font-semibold mb-4">Dependencias para: <span className="text-blue-700">{currentActivityForDependencies.sudsName} - {currentActivityForDependencies.activityName}</span></h3>
                <p className="text-sm text-gray-600 mb-4">Selecciona actividades que se realizan si esta es positiva.</p>
                <div className="max-h-80 overflow-y-auto mb-4 border rounded-md p-2">
                  {allActivitiesFlat
                    .filter(act => act.id !== `${currentActivityForDependencies.sudsId}-${currentActivityForDependencies.category}-${currentActivityForDependencies.activityName}` && act.sudsId === currentActivityForDependencies.sudsId)
                    .map(act => (
                      <div key={act.id} className="flex items-center mb-2 p-1 rounded-md hover:bg-gray-100">
                        <input type="checkbox" id={`dep-${act.id}`} checked={selectedDependencies.includes(act.id)} onChange={() => handleToggleDependency(act.id)} className="form-checkbox h-4 w-4"/>
                        <label htmlFor={`dep-${act.id}`} className="ml-2 text-sm">{act.sudsName} - {act.category} - {act.activityName}</label>
                      </div>
                    ))}
                </div>
                <div className="flex justify-end space-x-2">
                  <button onClick={() => setShowDependenciesModal(false)} className="px-4 py-2 bg-gray-300 rounded-md">Cancelar</button>
                  <button onClick={handleSaveDependencies} className="px-4 py-2 bg-blue-600 text-white rounded-md">Guardar</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// Function to prepare activities for display, including dependencies
const getDisplayActivities = (sudsId, allMaintenanceActivities, categories, definedActivityNames) => {
  const sudsActivities = allMaintenanceActivities.filter(act => act.sudsTypeId === sudsId && act.applies);
  const activityMap = new Map(sudsActivities.map(act => [act.id || `${act.sudsTypeId}-${act.category}-${act.activityName}`, act])); // Ensure ID exists for mapping

  const processedActivityIds = new Set();
  const displayedOrder = [];

  const allDependentIds = new Set();
  sudsActivities.forEach(act => {
    if (act.dependentActivities) {
      act.dependentActivities.forEach(depId => allDependentIds.add(depId));
    }
  });

  let topLevelActivities = sudsActivities.filter(act => !allDependentIds.has(act.id || `${act.sudsTypeId}-${act.category}-${act.activityName}`));

  topLevelActivities.sort((a, b) => {
    const categoryAIndex = categories.indexOf(a.category);
    const categoryBIndex = categories.indexOf(b.category);
    if (categoryAIndex !== categoryBIndex) return categoryAIndex - categoryBIndex;
    const activityIndexA = (definedActivityNames[a.category] || []).indexOf(a.activityName);
    const activityIndexB = (definedActivityNames[b.category] || []).indexOf(b.activityName);
    return activityIndexA - activityIndexB;
  });

  const addActivityAndDependents = (activity) => {
    const activityId = activity.id || `${activity.sudsTypeId}-${activity.category}-${activity.activityName}`;
    if (processedActivityIds.has(activityId)) return;

    displayedOrder.push({ ...activity, isDependent: activity.isDependent || false });
    processedActivityIds.add(activityId);

    const sortedDependents = (activity.dependentActivities || [])
      .map(depId => activityMap.get(depId))
      .filter(Boolean)
      .sort((a, b) => {
        const catAIdx = categories.indexOf(a.category);
        const catBIdx = categories.indexOf(b.category);
        if (catAIdx !== catBIdx) return catAIdx - catBIdx;
        const actIdxA = (definedActivityNames[a.category] || []).indexOf(a.activityName);
        const actIdxB = (definedActivityNames[b.category] || []).indexOf(b.activityName);
        return actIdxA - actIdxB;
      });

    sortedDependents.forEach(depAct => addActivityAndDependents({ ...depAct, isDependent: true }));
  };

  topLevelActivities.forEach(addActivityAndDependents);
  return displayedOrder;
};

// --- New Tab 4: Detalle de Actividades por SUDS ---
const SudsActivityDetailsTab = () => {
  const { db, userId, appId, showCustomModal } = useAppContext(); // appId here is now appIdentifier
  const [sudsTypes, setSudsTypes] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [maintenanceActivities, setMaintenanceActivities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [definedActivityNames, setDefinedActivityNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [filterLocationTypes, setFilterLocationTypes] = useState([]);

  const canEditDetails = true;
  const SUDS_DEDICATED_CONTRACT_NAME = 'Actividad específica';

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

    const fetchInitialData = async () => {
      try {
        const sudsRef = collection(db, `artifacts/${appId}/public/data/sudsTypes`);
        const unsubscribeSuds = onSnapshot(sudsRef, (snapshot) => {
          const fetchedSudsTypes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          const sudsTypesWithOrder = fetchedSudsTypes.map((suds, index) => ({
            ...suds,
            order: suds.order === undefined ? index : suds.order,
          }));
          setSudsTypes(sudsTypesWithOrder.sort((a, b) => (a.order || 0) - (b.order || 0)));
          setLoading(false); // Set loading false after SUDS types are fetched
        }, (error) => {
          console.error("Error fetching SUDS types:", error);
          showCustomModal(`Error al cargar tipos de SUDS: ${error.message}`);
          setLoading(false);
        });

        const contractsSnapshot = await getDocs(collection(db, `artifacts/${appId}/public/data/contracts`));
        setContracts(contractsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const activitiesRef = collection(db, `artifacts/${appId}/public/data/maintenanceActivities`);
        const unsubscribeActivities = onSnapshot(activitiesRef, (snapshot) => {
          setMaintenanceActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        const categoriesRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories');
        const unsubscribeCategories = onSnapshot(categoriesRef, (docSnap) => {
          if (docSnap.exists() && docSnap.data().categories) setCategories(docSnap.data().categories);
        });

        const definedActivitiesRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames');
        const unsubscribeDefinedActivities = onSnapshot(definedActivitiesRef, (docSnap) => {
          if (docSnap.exists() && docSnap.data()) setDefinedActivityNames(docSnap.data());
          else setDefinedActivityNames({});
        });

        return () => {
          unsubscribeSuds();
          unsubscribeActivities();
          unsubscribeCategories();
          unsubscribeDefinedActivities();
        };

      } catch (error) {
        console.error("Error fetching initial data for details tab:", error);
        showCustomModal(`Error al cargar datos iniciales: ${error.message}`);
        setLoading(false);
      }
    };
    fetchInitialData();
  }, [db, appId, showCustomModal]);

  const handleUpdateActivityDetail = async (activityId, field, value) => {
    if (!db) return;
    try {
      const activityRef = doc(db, `artifacts/${appId}/public/data/maintenanceActivities`, activityId);
      const activitySnap = await getDoc(activityRef);
      if (!activitySnap.exists()) {
        showCustomModal("Error: Actividad no encontrada."); return;
      }
      await updateDoc(activityRef, {
        [field]: value,
        lastUpdatedBy: userId,
        timestamp: new Date(),
        validationStatus: 'pendiente',
      });
    } catch (error) {
      console.error("Error updating activity detail:", error);
      showCustomModal(`Error al guardar el detalle: ${error.message}`);
    }
  };

  const handleToggleFilterLocationType = (typeId) => {
    setFilterLocationTypes(prev => prev.includes(typeId) ? prev.filter(id => id !== typeId) : [...prev, typeId]);
  };

  if (loading) return <div className="text-center text-gray-600">Cargando detalles...</div>;
  if (!db) return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible.</div>;

  const allActivitiesFlat = generateAllActivitiesFlat(sudsTypes, categories, definedActivityNames);
  const filteredSudsTypesByLocation = sudsTypes.filter(suds =>
    filterLocationTypes.length === 0 || filterLocationTypes.some(filterType => suds.locationTypes?.includes(filterType))
  );
  const sudsTypesToDisplay = filteredSudsTypesByLocation.filter(suds =>
    maintenanceActivities.some(act => act.sudsTypeId === suds.id && act.applies)
  );

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">Detalle de Actividades por SUDS</h2>
      <div className="mb-8 p-4 bg-gray-100 rounded-lg border">
        <h3 className="text-xl font-semibold mb-3">Filtrar por Ubicación</h3>
        <div className="flex flex-wrap gap-2">
          {locationTypeOptions.map(option => (
            <button key={`filter-${option.id}`} onClick={() => handleToggleFilterLocationType(option.id)}
              className={`flex items-center p-2 rounded-md border ${filterLocationTypes.includes(option.id) ? 'bg-blue-500 text-white' : 'bg-gray-200 hover:bg-blue-100'}`}>
              {option.icon.startsWith('http') ? <img src={option.icon} alt={option.name} className="h-6 w-6"/> : <span className="text-xl">{option.icon}</span>}
              <span className="ml-2 text-sm">{option.name}</span>
            </button>
          ))}
          {filterLocationTypes.length > 0 && <button onClick={() => setFilterLocationTypes([])} className="p-2 rounded-md bg-red-500 text-white text-sm">Limpiar</button>}
        </div>
      </div>

      {sudsTypesToDisplay.length === 0 ? (
        <p className="text-gray-600">No hay actividades aplicables para los SUDS filtrados. Ve a "Definición de Actividades" o ajusta filtros.</p>
      ) : (
        <div className="space-y-8">
          {sudsTypesToDisplay.map((suds) => {
            const sudsDisplayActivities = getDisplayActivities(suds.id, maintenanceActivities, categories, definedActivityNames);
            if (sudsDisplayActivities.length === 0) return null;

            return (
              <div key={suds.id} className="bg-gray-50 border rounded-lg p-4 shadow-sm">
                <h3 className="text-xl font-bold mb-4 flex items-center">
                  {suds.name}
                  {suds.locationTypes?.length > 0 && <div className="ml-2 flex gap-1">{locationTypeOptions.map(opt => suds.locationTypes.includes(opt.id) && <span key={opt.id} title={opt.name}>{opt.icon.startsWith('http') ? <img src={opt.icon} className="h-4 w-4"/> : opt.icon}</span>)}</div>}
                  {suds.imageUrls?.[0] && <img src={suds.imageUrls[0]} alt={`[Image of ${suds.name}]`} className="w-10 h-10 rounded-md ml-2"/>}
                </h3>
                <div className="overflow-x-auto rounded-lg border shadow-sm">
                  <table className="min-w-full divide-y">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase w-1/5">Actividad</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase">Estado Contrato</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase">Contratos</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase">Frecuencia</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase">Comentario</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y">
                      {sudsDisplayActivities.map(activity => {
                        const statusColor = activity.status === 'verde' ? 'bg-green-50' : activity.status === 'amarillo' ? 'bg-yellow-50' : activity.status === 'rojo' ? 'bg-red-50' : '';
                        const involvedContracts = activity.involvedContracts || [];
                        return (
                          <tr key={activity.id || `${activity.sudsTypeId}-${activity.category}-${activity.activityName}`} className={statusColor}>
                            <td className={`px-4 py-3 text-sm font-medium ${activity.isDependent ? 'pl-8 italic text-gray-600' : ''}`}>
                              <div className="flex items-center">{activity.isDependent && <span className="mr-2">↳</span>}{activity.activityName}</div>
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {canEditDetails ? <select value={activity.status || ''} onChange={(e) => handleUpdateActivityDetail(activity.id, 'status', e.target.value)} className="w-full p-1 border rounded-md text-sm">
                                <option value="">Seleccionar</option> <option value="verde">Incluido</option> <option value="amarillo">Integrable</option> <option value="rojo">Específica</option> <option value="no_aplica">No aplica</option>
                              </select> : <span>{activity.status || 'N/A'}</span>}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {canEditDetails ? <div className="flex flex-wrap gap-1 py-1">{contracts.map(c => <button key={c.id} onClick={() => handleUpdateActivityDetail(activity.id, 'involvedContracts', involvedContracts.includes(c.name) ? involvedContracts.filter(n => n !== c.name) : [...involvedContracts, c.name])} className={`w-10 h-10 rounded-md text-xs overflow-hidden ${involvedContracts.includes(c.name) ? 'bg-blue-500 ring-2' : 'border'}`} title={c.name}>{c.logoUrl ? <img src={c.logoUrl} className="w-full h-full object-contain"/> : '?'}</button>)}</div> : <p>{involvedContracts.join(', ') || 'N/A'}</p>}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {canEditDetails ? <input type="text" value={activity.frequency || ''} onChange={(e) => handleUpdateActivityDetail(activity.id, 'frequency', e.target.value)} placeholder="Ej: anual" className="w-full p-1 border rounded-md text-sm"/> : <span>{activity.frequency || 'N/A'}</span>}
                              {activity.dependentActivities?.length > 0 && <div className="text-xs mt-1" title={`Depende de: ${activity.dependentActivities.join(', ')}`}>🔗 Depende</div>}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {canEditDetails ? <textarea value={activity.comment || ''} onChange={(e) => handleUpdateActivityDetail(activity.id, 'comment', e.target.value)} placeholder="Comentario" rows="2" className="w-full p-1 border rounded-md text-sm"/> : <p>{activity.comment || 'S/C'}</p>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// --- Tab 5: Resumen por contrato y validación ---
const SummaryTab = () => {
  const { db, userId, userRole, appId, showCustomModal } = useAppContext(); // appId here is now appIdentifier
  const [contracts, setContracts] = useState([]);
  const [sudsTypes, setSudsTypes] = useState([]);
  const [maintenanceActivities, setMaintenanceActivities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [definedActivityNames, setDefinedActivityNames] = useState({});
  const [selectedContractId, setSelectedContractId] = useState('');
  const [loading, setLoading] = useState(true);
  const [contractAnalysis, setContractAnalysis] = useState('');
  const [generatingAnalysis, setGeneratingAnalysis] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [currentValidatorComment, setCurrentValidatorComment] = useState({});

  const canValidate = true;
  const locationTypeOptions = [
    { id: 'acera', name: 'Acera', icon: '🚶‍♀️' }, { id: 'zona_verde', name: 'Zona Verde', icon: '🌳' },
    { id: 'viario', name: 'Viario', icon: '🚗' }, { id: 'infraestructura', name: 'Infraestructura', icon: 'https://img.freepik.com/vector-premium/icono-tuberia-fontanero-vector-simple-servicio-agua-tubo-aguas-residuales_98396-55465.jpg' },
  ];

  useEffect(() => {
    if (!db || !appId) { // appId here is appIdentifier from context
      setLoading(false);
      return;
    }
    const fetchInitialData = async () => {
      try {
        const contractsSnap = await getDocs(collection(db, `artifacts/${appId}/public/data/contracts`));
        const contractsData = contractsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setContracts(contractsData);
        if (contractsData.length > 0) setSelectedContractId(contractsData[0].id); else setSelectedContractId('');

        const sudsRef = collection(db, `artifacts/${appId}/public/data/sudsTypes`);
        const unsubSuds = onSnapshot(sudsRef, (snap) => {
          const fetchedSuds = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setSudsTypes(fetchedSuds.map((s, i) => ({ ...s, order: s.order === undefined ? i : s.order })).sort((a,b) => (a.order || 0) - (b.order || 0)));
        });

        const activitiesRef = collection(db, `artifacts/${appId}/public/data/maintenanceActivities`);
        const unsubActivities = onSnapshot(activitiesRef, (snap) => {
          const actsData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setMaintenanceActivities(actsData);
          const initialComments = {};
          actsData.forEach(act => { initialComments[act.id] = act.validatorComment || ''; });
          setCurrentValidatorComment(initialComments);
          setLoading(false); // Loading false after activities
        }, (err) => { console.error(err); setLoading(false); });

        const catsRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories');
        const unsubCats = onSnapshot(catsRef, (snap) => { if (snap.exists()) setCategories(snap.data().categories); });

        const defActsRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames');
        const unsubDefActs = onSnapshot(defActsRef, (snap) => { if (snap.exists()) setDefinedActivityNames(snap.data()); else setDefinedActivityNames({}); });

        return () => { unsubSuds(); unsubActivities(); unsubCats(); unsubDefActs(); };
      } catch (error) {
        console.error("Error fetching for summary tab:", error);
        showCustomModal(`Error al cargar datos: ${error.message}`);
        setLoading(false);
      }
    };
    fetchInitialData();
  }, [db, appId, showCustomModal]);

  const handleValidation = async (activityId, status) => {
    if (!db) return;
    const commentToSave = currentValidatorComment[activityId] || '';
    try {
      await updateDoc(doc(db, `artifacts/${appId}/public/data/maintenanceActivities`, activityId), {
        validationStatus: status, validatorComment: commentToSave, validatedBy: userId, validationTimestamp: new Date(),
      });
      showCustomModal(`Actividad ${status} con éxito.`);
    } catch (error) {
      console.error("Error updating validation:", error);
      showCustomModal(`Error al validar: ${error.message}`);
    }
  };

  const handleGenerateContractAnalysis = async () => {
    if (!selectedContract) { showCustomModal("Selecciona un contrato."); return; }
    setGeneratingAnalysis(true); setContractAnalysis('');
    try {
      const contractDetails = `Contrato: ${selectedContract.name}, Resp: ${selectedContract.responsible}, Resumen: ${selectedContract.summary}.`;
      const activitiesDetails = filteredActivities.map(act =>
        `SUDS: ${sudsTypes.find(s => s.id === act.sudsTypeId)?.name || 'N/A'}, Cat: ${act.category}, Act: ${act.activityName}, Estado: ${act.status}, Com: ${act.comment || 'N/A'}, Val: ${act.validationStatus || 'N/A'}.`
      ).join('\n');
      const prompt = `Análisis conciso del contrato SUDS y actividades. Puntos fuertes, mejoras, riesgos, recomendaciones.
      Contrato: ${contractDetails}
      Actividades: ${activitiesDetails}
      Análisis (5-7 frases):`;

      let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
      const payload = { contents: chatHistory };
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        setContractAnalysis(result.candidates[0].content.parts[0].text);
        setShowAnalysisModal(true);
      } else { showCustomModal("No se pudo generar análisis."); }
    } catch (error) {
      console.error("Error Gemini API:", error);
      showCustomModal(`Error análisis: ${error.message}`);
    } finally { setGeneratingAnalysis(false); }
  };

  const selectedContract = contracts.find(c => c.id === selectedContractId);
  const filteredActivities = maintenanceActivities.filter(activity =>
    activity.applies && selectedContract && activity.involvedContracts?.includes(selectedContract.name)
  );
  const activitiesBySudsType = sudsTypes.reduce((acc, suds) => {
    acc[suds.id] = filteredActivities.filter(act => act.sudsTypeId === suds.id);
    return acc;
  }, {});
  const allActivitiesFlat = generateAllActivitiesFlat(sudsTypes, categories, definedActivityNames);

  if (loading) return <div className="text-center text-gray-600">Cargando resumen...</div>;
  if (!db) return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible.</div>;

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">Resumen por contrato y validación</h2>
      <div className="mb-6">
        <label htmlFor="contractFilter" className="block text-sm font-medium mb-1">Filtrar por Contrato:</label>
        <select id="contractFilter" value={selectedContractId} onChange={(e) => setSelectedContractId(e.target.value)} className="w-full md:w-1/2 lg:w-1/3 p-2 border rounded-md">
          {contracts.length === 0 ? <option value="">No hay contratos</option> : contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {selectedContract ? (
        <div>
          <h3 className="text-xl font-semibold mb-4">Actividades para: <span className="text-blue-700">{selectedContract.name}</span></h3>
          <p className="text-sm mb-4">Responsable: <span className="font-medium">{selectedContract.responsible}</span></p>
          <button onClick={handleGenerateContractAnalysis} disabled={generatingAnalysis} className="px-6 py-2 bg-indigo-600 text-white rounded-md mb-6 disabled:opacity-50">
            {generatingAnalysis ? 'Generando...' : '✨ Analizar Contrato'}
          </button>

          {sudsTypes.length === 0 || filteredActivities.length === 0 ? <p>No hay actividades para este contrato.</p> : (
            <div className="space-y-6">
              {sudsTypes.map(suds => {
                const displayActivitiesForSuds = getDisplayActivities(suds.id, maintenanceActivities, categories, definedActivityNames)
                  .filter(act => act.involvedContracts?.includes(selectedContract.name));
                if (displayActivitiesForSuds.length === 0) return null;
                return (
                  <div key={suds.id} className="bg-gray-50 border rounded-lg p-4">
                    <h4 className="text-lg font-bold mb-3 flex items-center">
                      {suds.name}
                      {suds.locationTypes?.length > 0 && <div className="ml-2 flex gap-1">{locationTypeOptions.map(opt => suds.locationTypes.includes(opt.id) && <span key={opt.id} title={opt.name}>{opt.icon.startsWith('http') ? <img src={opt.icon} className="h-4 w-4"/> : opt.icon}</span>)}</div>}
                      {suds.imageUrls?.[0] && <img src={suds.imageUrls[0]} className="w-10 h-10 rounded-md ml-2"/>}
                    </h4>
                    <p className="text-sm mb-4 p-2 bg-gray-100 rounded-md">{suds.description}</p>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">Categoría</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase w-[150px]">Actividad</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">Estado Prop.</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">Comentario Prop.</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">Frecuencia</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">Validación</th>
                            {canValidate && <th className="px-4 py-3 text-left text-xs font-medium uppercase">Acciones/Com. Validador</th>}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y">
                          {displayActivitiesForSuds.map(activity => {
                            const statusColor = activity.status === 'verde' ? 'bg-green-50' : activity.status === 'amarillo' ? 'bg-yellow-50' : activity.status === 'rojo' ? 'bg-red-50' : '';
                            const valColor = activity.validationStatus === 'validado' ? 'text-green-600' : activity.validationStatus === 'rechazado' ? 'text-red-600' : '';
                            return (
                              <tr key={activity.id || `${activity.sudsTypeId}-${activity.category}-${activity.activityName}`}>
                                <td className="px-4 py-3 text-sm">{activity.category}</td>
                                <td className="px-4 py-3 text-sm break-words">{activity.activityName}</td>
                                <td className={`px-4 py-3 text-sm ${statusColor}`}>{activity.status || 'N/A'}</td>
                                <td className="px-4 py-3 text-sm max-w-xs overflow-hidden">{activity.comment || 'S/C'}</td>
                                <td className="px-4 py-3 text-sm">{activity.frequency || 'N/A'} {activity.dependentActivities?.length > 0 && <span title={`Depende de: ${activity.dependentActivities.join(', ')}`}>🔗</span>}</td>
                                <td className={`px-4 py-3 text-sm ${valColor}`}>{activity.validationStatus || 'N/A'} {activity.validatedBy && <span className="text-xs block">Por: {activity.validatedBy.substring(0,6)}</span>} {activity.validatorComment && <span className="text-xs block italic">"{activity.validatorComment}"</span>}</td>
                                {canValidate && <td className="px-4 py-3 text-sm"><div className="flex flex-col space-y-2">
                                  <textarea placeholder="Comentario validador" rows="2" className="w-full p-1 border rounded-md text-sm" value={currentValidatorComment[activity.id] || ''} onChange={(e) => setCurrentValidatorComment(prev => ({...prev, [activity.id]: e.target.value }))} onBlur={() => handleValidation(activity.id, activity.validationStatus || 'pendiente')}/>
                                  <div className="flex space-x-2"><button onClick={() => handleValidation(activity.id, 'validado')} className="flex-1 px-3 py-1 bg-green-500 text-white rounded-md text-xs">Aceptar</button><button onClick={() => handleValidation(activity.id, 'rechazado')} className="flex-1 px-3 py-1 bg-red-500 text-white rounded-md text-xs">Rechazar</button><button onClick={() => handleValidation(activity.id, 'pendiente')} className="flex-1 px-3 py-1 bg-gray-500 text-white rounded-md text-xs">Reiniciar</button></div>
                                </div></td>}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : <p>Selecciona un contrato para ver el resumen.</p>}
      {showAnalysisModal && <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-lg p-6 max-w-2xl w-full"><h3 className="text-xl font-semibold mb-4">Análisis: {selectedContract?.name}</h3><div className="prose max-h-96 overflow-y-auto mb-4"><p>{contractAnalysis}</p></div><div className="flex justify-end"><button onClick={() => setShowAnalysisModal(false)} className="px-4 py-2 bg-gray-300 rounded-md">Cerrar</button></div></div></div>}
    </div>
  );
};

// --- New Tab 6: Resumen Visual ---
const VisualSummaryTab = () => {
  const { db, appId, showCustomModal } = useAppContext(); // appId here is now appIdentifier
  const [sudsTypes, setSudsTypes] = useState([]);
  const [maintenanceActivities, setMaintenanceActivities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [definedActivityNames, setDefinedActivityNames] = useState({});
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all');

  useEffect(() => {
    if (!db || !appId) { // appId here is appIdentifier from context
      setLoading(false);
      return;
    }
    const fetchAllData = async () => {
      try {
        const sudsSnap = await getDocs(collection(db, `artifacts/${appId}/public/data/sudsTypes`));
        setSudsTypes(sudsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const actsRef = collection(db, `artifacts/${appId}/public/data/maintenanceActivities`);
        const unsubActs = onSnapshot(actsRef, (snap) => {
          setMaintenanceActivities(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          setLoading(false); // Loading false after activities
        }, (err) => { console.error(err); setLoading(false); });

        const catsRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'maintenanceCategories');
        const unsubCats = onSnapshot(catsRef, (snap) => { if (snap.exists()) setCategories(snap.data().categories); });

        const defActsRef = doc(db, `artifacts/${appId}/public/data/appSettings`, 'definedActivityNames');
        const unsubDefActs = onSnapshot(defActsRef, (snap) => { if (snap.exists()) setDefinedActivityNames(snap.data()); else setDefinedActivityNames({}); });

        const contractsSnap = await getDocs(collection(db, `artifacts/${appId}/public/data/contracts`));
        setContracts(contractsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        return () => { unsubActs(); unsubCats(); unsubDefActs(); };
      } catch (error) {
        console.error("Error fetching for visual summary:", error);
        showCustomModal(`Error al cargar datos: ${error.message}`);
        setLoading(false);
      }
    };
    fetchAllData();
  }, [db, appId, showCustomModal]);

  const processChartData = () => {
    const proposedCounts = { 'Incluido en contrato': 0, 'Fácilmente integrable': 0, 'Actividad específica': 0, 'No aplica': 0, 'N/A': 0 };
    const validationCounts = { 'pendiente': 0, 'validado': 0, 'rechazado': 0, 'N/A': 0 };
    const sudsComparison = sudsTypes.map(s => ({ name: s.name, pv:0,pa:0,pr:0,pna:0, vv:0,vr:0,vp:0 }));

    maintenanceActivities.forEach(act => {
      if (!act.applies) return;
      if (act.status === 'verde') proposedCounts['Incluido en contrato']++; else if (act.status === 'amarillo') proposedCounts['Fácilmente integrable']++; else if (act.status === 'rojo') proposedCounts['Actividad específica']++; else if (act.status === 'no_aplica') proposedCounts['No aplica']++; else proposedCounts['N/A']++;
      if (act.validationStatus === 'validado') validationCounts['validado']++; else if (act.validationStatus === 'rechazado') validationCounts['rechazado']++; else if (act.validationStatus === 'pendiente') validationCounts['pendiente']++; else validationCounts['N/A']++;

      const sudsIdx = sudsComparison.findIndex(d => d.name === sudsTypes.find(s => s.id === act.sudsTypeId)?.name);
      if (sudsIdx !== -1) {
        if (act.status === 'verde') sudsComparison[sudsIdx].pv++; else if (act.status === 'amarillo') sudsComparison[sudsIdx].pa++; else if (act.status === 'rojo') sudsComparison[sudsIdx].pr++; else if (act.status === 'no_aplica') sudsComparison[sudsIdx].pna++;
        if (act.validationStatus === 'validado') sudsComparison[sudsIdx].vv++; else if (act.validationStatus === 'rechazado') sudsComparison[sudsIdx].vr++; else if (act.validationStatus === 'pendiente') sudsComparison[sudsIdx].vp++;
      }
    });
    const proposedPie = Object.keys(proposedCounts).map(k => ({ name: k, value: proposedCounts[k] })).filter(i => i.value > 0);
    const validationPie = Object.keys(validationCounts).map(k => ({ name: k, value: validationCounts[k] })).filter(i => i.value > 0);
    return { proposedPie, validationPie, sudsComparison };
  };

  const { proposedPieData, validationPieData, sudsTypeComparisonData } = processChartData();
  const COLORS_P = ['#4CAF50', '#FFC107', '#F44336', '#9E9E9E', '#BDBDBD'];
  const COLORS_V = ['#FFC107', '#4CAF50', '#F44336', '#BDBDBD'];
  const allUniqueActivityNames = Array.from(new Set(Object.values(definedActivityNames).flat())).sort();
  const filteredActivityNames = allUniqueActivityNames.filter(actName => selectedCategoryFilter === 'all' || (definedActivityNames[selectedCategoryFilter] || []).includes(actName));
  const getContractLogo = (name) => contracts.find(c => c.name === name)?.logoUrl || `https://placehold.co/32x32/ccc/fff?text=L`;

  if (loading) return <div className="text-center text-gray-600">Cargando resumen visual...</div>;
  if (!db) return <div className="text-center text-red-600 p-4">Error: La conexión con la base de datos no está disponible.</div>;

  return (
    <div className="p-4 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-2">Resumen Visual</h2>
      {maintenanceActivities.filter(act => act.applies).length === 0 ? <p>No hay actividades necesarias para generar resumen.</p> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-gray-50 p-4 rounded-lg shadow-sm"><h3 className="text-lg font-semibold mb-4 text-center">Estado Propuesto</h3><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={proposedPieData} cx="50%" cy="50%" labelLine={false} outerRadius={100} fill="#8884d8" dataKey="value" label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}>{proposedPieData.map((e, i) => <Cell key={`cell-p-${i}`} fill={COLORS_P[i % COLORS_P.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer></div>
          <div className="bg-gray-50 p-4 rounded-lg shadow-sm"><h3 className="text-lg font-semibold mb-4 text-center">Estado Validación</h3><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={validationPieData} cx="50%" cy="50%" labelLine={false} outerRadius={100} fill="#82ca9d" dataKey="value" label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}>{validationPieData.map((e, i) => <Cell key={`cell-v-${i}`} fill={COLORS_V[i % COLORS_V.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer></div>
          <div className="lg:col-span-2 bg-gray-50 p-4 rounded-lg shadow-sm overflow-x-auto"><h3 className="text-lg font-semibold mb-4 text-center">Estado Contrato por SUDS y Actividad</h3>
            <div className="mb-4 flex items-center justify-center"><label htmlFor="catFilter" className="mr-2">Filtrar Categoría:</label><select id="catFilter" value={selectedCategoryFilter} onChange={(e) => setSelectedCategoryFilter(e.target.value)} className="p-2 border rounded-md"><option value="all">Todas</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <table className="min-w-full divide-y"><thead className="bg-gray-100"><tr><th className="px-4 py-3 text-left text-xs font-medium uppercase sticky left-0 bg-gray-100 z-10">SUDS</th>{filteredActivityNames.map(a => <th key={a} className="px-2 py-3 text-xs font-medium uppercase">{a}</th>)}</tr></thead>
            <tbody className="bg-white divide-y">{sudsTypes.map(suds => <tr key={suds.id}><td className="px-4 py-4 text-sm font-medium sticky left-0 bg-white z-10">{suds.name}</td>{filteredActivityNames.map(actName => {
              const act = maintenanceActivities.find(a => a.sudsTypeId === suds.id && a.activityName === actName && a.applies);
              let bg = 'bg-gray-50', logos = [];
              if(act){ if(act.status === 'verde') bg='bg-green-100'; else if(act.status === 'amarillo') bg='bg-yellow-100'; else if(act.status === 'rojo') bg='bg-red-100'; else if(act.status === 'no_aplica') bg='bg-gray-200'; if(act.involvedContracts?.length > 0) logos = act.involvedContracts.map(n => ({n,u:getContractLogo(n)})).sort((a,b)=>a.n.localeCompare(b.n));}
              return <td key={`${suds.id}-${actName}`} className={`p-2 border text-center ${bg}`}>{act && act.status && act.status !== 'no_aplica' && logos.length > 0 && <div className="flex flex-wrap justify-center gap-1" title={(act.comment ? `Com: ${act.comment}\n`:'')+`Contr: ${logos.map(l=>l.n).join(', ')}`}>{logos.map((l,x)=><img key={x} src={l.u} alt={l.n} className="w-8 h-8 rounded-full object-contain"/>)}</div>}{act && act.status === 'no_aplica' && <span className="text-xs">N/A</span>}</td>;})}</tr>)}</tbody></table>
          </div>
          <div className="lg:col-span-2 bg-gray-50 p-4 rounded-lg shadow-sm"><h3 className="text-lg font-semibold mb-4 text-center">Comparación por Tipo de SUDS</h3><ResponsiveContainer width="100%" height={400}><BarChart data={sudsTypeComparisonData} margin={{top:20,right:30,left:20,bottom:5}}><CartesianGrid/><XAxis dataKey="name"/><YAxis/><Tooltip/><Legend/><Bar dataKey="pv" stackId="p" fill="#4CAF50" name="Prop: Incluido"/><Bar dataKey="pa" stackId="p" fill="#FFC107" name="Prop: Integrable"/><Bar dataKey="pr" stackId="p" fill="#F44336" name="Prop: Específica"/><Bar dataKey="pna" stackId="p" fill="#9E9E9E" name="Prop: No aplica"/><Bar dataKey="vv" stackId="v" fill="#2196F3" name="Validado"/><Bar dataKey="vr" stackId="v" fill="#FF5722" name="Rechazado"/><Bar dataKey="vp" stackId="v" fill="#FFEB3B" name="Pendiente"/></BarChart></ResponsiveContainer></div>
        </div>
      )}
    </div>
  );
};

export default App;
