import { Navigate } from 'react-router-dom'
import useStore from '../store/useStore.js'
import { isExecutive } from '../utils/roles.js'

export function RequireExecutive({ children }) {
  const activeUser = useStore((s) => s.activeUser)
  if (!isExecutive(activeUser)) return <Navigate to="/" replace />
  return children
}
