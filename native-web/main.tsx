import { createRoot } from "react-dom/client";
import "../src/styles.css";
import Playroom from "../src/components/game/Playroom";

// Offline entry of the Android app: the game only, nothing is fetched from the network.
const el = document.getElementById("root");
if (el) createRoot(el).render(<Playroom />);
