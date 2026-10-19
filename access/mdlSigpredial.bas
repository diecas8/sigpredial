Attribute VB_Name = "mdlSigpredial"
'==========================================================================
' SIP · SIGPREDIAL — Conexión de Access a la base central (SOLO LECTURA)
' Corporación Biocomercio Sostenible
'
' REQUISITO: tener instalado el controlador ODBC de PostgreSQL (psqlODBC)
'            con la misma arquitectura de Office (64 o 32 bits).
'
' CÓMO USARLO
'   1. Cree una base de Access en blanco (ej. Consultas_Sigpredial.accdb).
'   2. Alt+F11 > Archivo > Importar archivo... > mdlSigpredial.bas
'   3. Haga clic dentro de "Sub VincularSigpredial" y presione F5.
'   4. Escriba la clave del usuario lector_oficina cuando la pida.
'
' Resultado: tablas vinculadas Productores, Predios, Lotes y
' Resumen_cultivos (se actualizan solas con los datos de Sigpredial)
' y consultas de ejemplo. Para volver a conectar, ejecútelo de nuevo.
'==========================================================================
Option Compare Database
Option Explicit

Private Const SERVIDOR As String = "aws-1-ca-central-1.pooler.supabase.com"
Private Const PUERTO As String = "5432"
Private Const BASEDATOS As String = "postgres"
Private Const USUARIO As String = "lector_oficina.usbqciezxkbyixqlnlhm"

Private mUltimoError As String

'--------------------------------------------------------------------------
' PROCEDIMIENTO PRINCIPAL (ejecutar con F5)
'--------------------------------------------------------------------------
Public Sub VincularSigpredial()
    Dim clave As String, cn As String, drv As Variant, conectado As Boolean
    Dim fuentes As Variant, nombres As Variant, i As Integer

    On Error GoTo ErrH

    clave = InputBox("Escriba la contraseña del usuario lector_oficina:", "Conectar a Sigpredial")
    If Len(clave) = 0 Then Exit Sub

    DoCmd.Hourglass True
    For Each drv In Array("PostgreSQL Unicode(x64)", "PostgreSQL Unicode", "PostgreSQL ANSI(x64)", "PostgreSQL ANSI")
        cn = CadenaConexion(CStr(drv), clave)
        If ProbarConexion(cn) Then
            conectado = True
            Exit For
        End If
    Next
    DoCmd.Hourglass False

    If Not conectado Then
        MsgBox "No se pudo conectar a Sigpredial." & vbCrLf & vbCrLf & _
               "Revise que:" & vbCrLf & _
               " - Esté instalado el controlador ODBC de PostgreSQL (psqlODBC)" & vbCrLf & _
               "   de la misma arquitectura que Office (64 o 32 bits)." & vbCrLf & _
               " - La contraseña de lector_oficina sea correcta." & vbCrLf & _
               " - Haya conexión a internet." & vbCrLf & vbCrLf & _
               "Detalle: " & mUltimoError, vbExclamation, "Sigpredial"
        Exit Sub
    End If

    DoCmd.Hourglass True
    fuentes = Array("productores.r_productores", "productores.r_predios", _
                    "productores.r_lotes", "productores.r_resumen_cultivos")
    nombres = Array("Productores", "Predios", "Lotes", "Resumen_cultivos")

    For i = 0 To UBound(fuentes)
        Vincular CStr(nombres(i)), CStr(fuentes(i)), cn
    Next

    CrearIndice "Productores", "id"
    CrearIndice "Predios", "id"
    CrearIndice "Lotes", "id"

    CrearConsultas
    DoCmd.Hourglass False

    MsgBox "Conexión lista." & vbCrLf & vbCrLf & _
           "Tablas vinculadas: Productores, Predios, Lotes y Resumen_cultivos." & vbCrLf & _
           "Los datos son de SOLO LECTURA y se actualizan solos." & vbCrLf & vbCrLf & _
           "Revise las consultas de ejemplo en el panel izquierdo.", vbInformation, "Sigpredial"
    Exit Sub

ErrH:
    DoCmd.Hourglass False
    MsgBox "Error " & Err.Number & ": " & Err.Description, vbCritical, "Sigpredial"
End Sub

'--------------------------------------------------------------------------
' Utilidades
'--------------------------------------------------------------------------
Private Function CadenaConexion(controlador As String, clave As String) As String
    CadenaConexion = "ODBC;DRIVER={" & controlador & "};" & _
                     "SERVER=" & SERVIDOR & ";PORT=" & PUERTO & ";" & _
                     "DATABASE=" & BASEDATOS & ";UID=" & USUARIO & ";PWD=" & clave & ";" & _
                     "SSLmode=require;TextAsLongVarchar=0;MaxVarcharSize=255;"
End Function

Private Function ProbarConexion(cn As String) As Boolean
    Dim c As Object
    On Error Resume Next
    Set c = CreateObject("ADODB.Connection")
    c.ConnectionTimeout = 20
    c.Open Mid(cn, 6)      ' sin el prefijo "ODBC;"
    If Err.Number = 0 Then
        ProbarConexion = True
        c.Close
    Else
        mUltimoError = Err.Description
    End If
    Err.Clear
End Function

Private Sub Vincular(nombre As String, fuente As String, cn As String)
    Dim db As DAO.Database, td As DAO.TableDef
    Set db = CurrentDb
    BorrarTabla nombre
    Set td = db.CreateTableDef(nombre)
    td.Connect = cn
    td.SourceTableName = fuente
    td.Attributes = dbAttachSavePWD
    db.TableDefs.Append td
    db.TableDefs.Refresh
End Sub

Private Sub CrearIndice(tabla As String, campo As String)
    On Error Resume Next
    CurrentDb.Execute "CREATE UNIQUE INDEX pk_" & tabla & " ON [" & tabla & "] ([" & campo & "]) WITH PRIMARY"
    Err.Clear
End Sub

Private Sub BorrarTabla(nombre As String)
    On Error Resume Next
    DoCmd.DeleteObject acTable, nombre
    Err.Clear
End Sub

Private Sub NuevaConsulta(nombre As String, sql As String)
    On Error Resume Next
    CurrentDb.QueryDefs.Delete nombre
    Err.Clear
    On Error GoTo 0
    CurrentDb.CreateQueryDef nombre, sql
End Sub

'--------------------------------------------------------------------------
' Consultas de ejemplo (se pueden modificar o copiar libremente)
'--------------------------------------------------------------------------
Private Sub CrearConsultas()
    NuevaConsulta "Consulta 1 - Predios por municipio y vereda", _
        "SELECT municipio, vereda, Count(*) AS n_predios, Sum(area_sig_ha) AS area_ha " & _
        "FROM Predios GROUP BY municipio, vereda ORDER BY municipio, vereda;"

    NuevaConsulta "Consulta 2 - Área por municipio y cultivo", _
        "SELECT municipio, cultivo, Count(*) AS n_lotes, Sum(area_sig_ha) AS area_ha, " & _
        "Sum(num_plantas) AS plantas FROM Lotes " & _
        "GROUP BY municipio, cultivo ORDER BY municipio, cultivo;"

    NuevaConsulta "Consulta 3 - Productores con sus predios", _
        "SELECT p.num_doc, p.nombre_completo, p.telefono, p.asociacion, pr.cod_predio, " & _
        "pr.predio, pr.municipio, pr.vereda, pr.area_sig_ha, pr.n_lotes " & _
        "FROM Productores AS p INNER JOIN Predios AS pr ON p.id = pr.productor_id " & _
        "ORDER BY p.nombre_completo, pr.cod_predio;"

    NuevaConsulta "Consulta 4 - Lotes de café por edad", _
        "SELECT cod_lote, productor, municipio, vereda, variedad, fecha_siembra, edad_meses, " & _
        "estado, area_sig_ha, num_plantas, densidad_ha FROM Lotes " & _
        "WHERE cultivo = 'Café' ORDER BY edad_meses DESC;"

    NuevaConsulta "Consulta 5 - Buscar productor por documento", _
        "PARAMETERS [Número de documento] Text ( 255 ); " & _
        "SELECT p.*, pr.cod_predio, pr.predio, pr.municipio, pr.vereda, pr.area_sig_ha " & _
        "FROM Productores AS p LEFT JOIN Predios AS pr ON p.id = pr.productor_id " & _
        "WHERE p.num_doc = [Número de documento];"
End Sub
