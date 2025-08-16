"""WebSocket connection manager for handling multiple connections."""

import uuid
import logging
from typing import Dict, List, Optional, Set
from fastapi import WebSocket

logger = logging.getLogger("server")


class ConnectionManager:
    """Manages multiple WebSocket connections with unique identifiers."""
    
    def __init__(self):
        # Active connections: connection_id -> websocket
        self.active_connections: Dict[str, WebSocket] = {}
        # Session mapping: session_id -> connection_id  
        self.session_to_connection: Dict[str, str] = {}
        # Connection metadata: connection_id -> metadata
        self.connection_metadata: Dict[str, Dict] = {}
    
    def connect(self, websocket: WebSocket, session_id: Optional[str] = None) -> str:
        """
        Register a new WebSocket connection.
        
        Args:
            websocket: The WebSocket connection
            session_id: Optional session ID from client
            
        Returns:
            connection_id: Unique identifier for this connection
        """
        connection_id = str(uuid.uuid4())
        self.active_connections[connection_id] = websocket
        
        # Store metadata
        self.connection_metadata[connection_id] = {
            "session_id": session_id,
            "client": str(websocket.client) if websocket.client else "unknown",
            "connected_at": None,  # Can add timestamp if needed
        }
        
        # Map session_id to connection_id if provided
        if session_id:
            self.session_to_connection[session_id] = connection_id
        
        logger.info("WS CONNECT: connection_id=%s session_id=%s client=%s", 
                   connection_id, session_id, websocket.client)
        return connection_id
    
    def disconnect(self, connection_id: str):
        """Remove a WebSocket connection."""
        if connection_id in self.active_connections:
            metadata = self.connection_metadata.get(connection_id, {})
            session_id = metadata.get("session_id")
            
            # Remove from all mappings
            del self.active_connections[connection_id]
            del self.connection_metadata[connection_id]
            
            if session_id and session_id in self.session_to_connection:
                del self.session_to_connection[session_id]
            
            logger.info("WS DISCONNECT: connection_id=%s session_id=%s", 
                       connection_id, session_id)
    
    def get_connection(self, connection_id: str) -> Optional[WebSocket]:
        """Get WebSocket by connection ID."""
        return self.active_connections.get(connection_id)
    
    def get_connection_by_session(self, session_id: str) -> Optional[WebSocket]:
        """Get WebSocket by session ID."""
        connection_id = self.session_to_connection.get(session_id)
        if connection_id:
            return self.active_connections.get(connection_id)
        return None
    
    def get_all_connections(self) -> List[WebSocket]:
        """Get all active WebSocket connections."""
        return list(self.active_connections.values())
    
    def get_connection_ids(self) -> Set[str]:
        """Get all active connection IDs."""
        return set(self.active_connections.keys())
    
    def get_session_ids(self) -> Set[str]:
        """Get all active session IDs."""
        return set(self.session_to_connection.keys())
    
    def update_session_id(self, connection_id: str, session_id: str):
        """Update session ID for an existing connection."""
        if connection_id in self.active_connections:
            # Remove old session mapping if exists
            old_session = self.connection_metadata[connection_id].get("session_id")
            if old_session and old_session in self.session_to_connection:
                del self.session_to_connection[old_session]
            
            # Update metadata and create new mapping
            self.connection_metadata[connection_id]["session_id"] = session_id
            self.session_to_connection[session_id] = connection_id
            
            logger.info("WS SESSION UPDATE: connection_id=%s session_id=%s", 
                       connection_id, session_id)
    
    def get_connection_info(self, connection_id: str) -> Optional[Dict]:
        """Get connection metadata."""
        return self.connection_metadata.get(connection_id)
    
    def broadcast_to_all(self, message: str):
        """Broadcast message to all active connections."""
        disconnected = []
        for connection_id, websocket in self.active_connections.items():
            try:
                # Note: This would need to be async in practice
                # websocket.send_text(message)
                pass
            except Exception as exc:
                logger.warning("Failed to broadcast to %s: %s", connection_id, exc)
                disconnected.append(connection_id)
        
        # Clean up disconnected connections
        for connection_id in disconnected:
            self.disconnect(connection_id)
    
    def get_stats(self) -> Dict:
        """Get connection statistics."""
        return {
            "total_connections": len(self.active_connections),
            "connections_with_sessions": len(self.session_to_connection),
            "active_connection_ids": list(self.active_connections.keys()),
            "active_session_ids": list(self.session_to_connection.keys()),
        }


# Global connection manager instance
connection_manager = ConnectionManager()
