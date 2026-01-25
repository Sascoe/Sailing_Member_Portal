import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "../app/firebase";

type Role = "prospie" | "member" | "alumni";
type Positions = string[]; 

export function useUserRole() { //set variables to null and loading to true while we wait for async work to be done
  const [role, setRole] = useState<Role | null>(null);
  const [positions, setPositions] = useState<Positions>([]); //create positions variable and setter function. Can either be a Positions or empty array 
  const [loading, setLoading] = useState(true);
  

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) { // if user is null, set role to null, set positions to [], stop loading, and end func
        setRole(null);
        setPositions([]); 
        setLoading(false);
        return;
      }

      const unsubUser = onSnapshot(doc(db, "users", user.uid), (snap) => {
        setRole((snap.data()?.role as Role) ?? null);
        const raw = snap.data()?.positions; 
        const safePositions = Array.isArray(raw) ? raw : []; 
        setPositions(safePositions);
        setLoading(false);
      });

      // when auth user changes, clean up user doc listener
      return () => unsubUser();
    });

    return () => unsubAuth();
  }, []);

  return { role, positions, loading };
}
