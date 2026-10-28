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
'      (si ya tenía una versión anterior, elimine primero el módulo viejo).
'   3. Haga clic dentro de "Sub VincularSigpredial" y presione F5.
'   4. Escriba la clave del usuario lector_oficina cuando la pida.
'
' Resultado:
'   - Tablas vinculadas: Productores, Predios, Lotes, Elementos,
'     Resumen_cultivos, Resumen_coberturas, Caracterizaciones (encuestas de
'     Kobo), Usos_declarados y Fichas (fichas prediales en PDF).
'     Datos en vivo de Sigpredial, de todos los departamentos.
'   - Consultas de ejemplo (Consulta 1 a 13).
'   - Formulario "Menu_Descargas" para el administrador: descarga a Excel
'     con filtros por departamento, municipio y rango de fechas, y botón
'     para abrir la ficha predial (PDF con el mapa) de un predio.
'     Para abrirlo después: doble clic en Menu_Descargas o ejecute AbrirDescargas.
'
' Versión 2026-10-27: departamento, código Humboldt, estado del límite,
' caracterizaciones de Kobo, usos declarados y fichas prediales en PDF.
'
' Para volver a conectar (o tras actualizar la base), ejecútelo de nuevo.
'==========================================================================
Option Compare Database
Option Explicit

Private Const SERVIDOR As String = "aws-1-ca-central-1.pooler.supabase.com"
Private Const PUERTO As String = "5432"
Private Const BASEDATOS As String = "postgres"
Private Const USUARIO As String = "lector_oficina.usbqciezxkbyixqlnlhm"
Private Const FORM_MENU As String = "Menu_Descargas"
Private Const CARPETA_DESCARGAS As String = "Descargas Sigpredial"

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
    DoCmd.Close acForm, FORM_MENU, acSaveNo
    fuentes = Array("productores.r_productores", "productores.r_predios", _
                    "productores.r_lotes", "productores.r_elementos", _
                    "productores.r_resumen_cultivos", "productores.r_resumen_coberturas", _
                    "productores.r_caracterizaciones", "productores.r_usos_declarados", _
                    "productores.r_fichas")
    nombres = Array("Productores", "Predios", "Lotes", "Elementos", "Resumen_cultivos", "Resumen_coberturas", _
                    "Caracterizaciones", "Usos_declarados", "Fichas")

    For i = 0 To UBound(fuentes)
        Vincular CStr(nombres(i)), CStr(fuentes(i)), cn
    Next

    CrearIndice "Productores", "id"
    CrearIndice "Predios", "id"
    CrearIndice "Lotes", "id"
    CrearIndice "Elementos", "id"
    CrearIndice "Caracterizaciones", "id"
    CrearIndice "Usos_declarados", "id"
    CrearIndice "Fichas", "id"

    CrearConsultas
    CrearMenuDescargas
    DoCmd.Hourglass False

    MsgBox "Conexión lista." & vbCrLf & vbCrLf & _
           "Tablas vinculadas: Productores, Predios, Lotes, Elementos," & vbCrLf & _
           "Resumen_cultivos, Resumen_coberturas, Caracterizaciones," & vbCrLf & _
           "Usos_declarados y Fichas." & vbCrLf & _
           "Los datos son de SOLO LECTURA y se actualizan solos." & vbCrLf & vbCrLf & _
           "Se abrirá el formulario Menu_Descargas para descargar a Excel.", vbInformation, "Sigpredial"
    AbrirDescargas
    Exit Sub

ErrH:
    DoCmd.Hourglass False
    MsgBox "Error " & Err.Number & ": " & Err.Description, vbCritical, "Sigpredial"
End Sub

Public Sub AbrirDescargas()
    DoCmd.OpenForm FORM_MENU
End Sub

'--------------------------------------------------------------------------
' Utilidades de conexión
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
        "SELECT departamento, municipio, vereda, Count(*) AS n_predios, Sum(area_sig_ha) AS area_ha " & _
        "FROM Predios GROUP BY departamento, municipio, vereda ORDER BY departamento, municipio, vereda;"

    NuevaConsulta "Consulta 2 - Área por municipio y cultivo", _
        "SELECT municipio, cultivo, Count(*) AS n_lotes, Sum(area_sig_ha) AS area_ha, " & _
        "Sum(num_plantas) AS plantas, Sum(sitios_estimados) AS sitios FROM Lotes " & _
        "GROUP BY municipio, cultivo ORDER BY municipio, cultivo;"

    NuevaConsulta "Consulta 3 - Productores con sus predios", _
        "SELECT p.num_doc, p.nombre_completo, p.telefono, p.asociacion, pr.cod_predio, " & _
        "pr.predio, pr.municipio, pr.vereda, pr.area_sig_ha, pr.n_lotes " & _
        "FROM Productores AS p INNER JOIN Predios AS pr ON p.id = pr.productor_id " & _
        "ORDER BY p.nombre_completo, pr.cod_predio;"

    NuevaConsulta "Consulta 4 - Lotes de café por edad", _
        "SELECT cod_lote, productor, municipio, vereda, variedad, fecha_siembra, edad_meses, " & _
        "estado, area_sig_ha, num_plantas, densidad_ha, sitios_estimados, ocupacion_pct FROM Lotes " & _
        "WHERE cultivo = 'Café' ORDER BY edad_meses DESC;"

    NuevaConsulta "Consulta 5 - Buscar productor por documento", _
        "PARAMETERS [Número de documento] Text ( 255 ); " & _
        "SELECT p.*, pr.cod_predio, pr.predio, pr.municipio, pr.vereda, pr.area_sig_ha " & _
        "FROM Productores AS p LEFT JOIN Predios AS pr ON p.id = pr.productor_id " & _
        "WHERE p.num_doc = [Número de documento];"

    NuevaConsulta "Consulta 6 - Área por tipo de cobertura", _
        "SELECT tipo_cobertura, Sum(n_lotes) AS lotes, Sum(area_ha) AS area_ha " & _
        "FROM Resumen_coberturas GROUP BY tipo_cobertura ORDER BY Sum(area_ha) DESC;"

    NuevaConsulta "Consulta 7 - Lotes por tipo de cobertura", _
        "SELECT tipo_cobertura, cultivo, cod_lote, productor, municipio, vereda, " & _
        "area_sig_ha, trazado, sitios_estimados, ocupacion_pct, estado FROM Lotes " & _
        "ORDER BY tipo_cobertura, cultivo, municipio;"

    NuevaConsulta "Consulta 8 - Predios con diferencia de área", _
        "SELECT cod_predio, predio, productor, num_doc, departamento, municipio, vereda, " & _
        "area_declarada_ha, area_sig_ha, dif_area_pct FROM Predios " & _
        "WHERE Abs(dif_area_pct) > 30 ORDER BY Abs(dif_area_pct) DESC;"

    NuevaConsulta "Consulta 9 - Elementos por predio", _
        "SELECT cod_predio, predio, productor, municipio, geometria, grupo, tipo, nombre, " & _
        "permanencia, estado, longitud_m, latitud, longitud FROM Elementos " & _
        "ORDER BY cod_predio, geometria, tipo;"

    NuevaConsulta "Consulta 10 - Caracterizaciones por municipio", _
        "SELECT departamento, municipio, Count(*) AS encuestas, Sum(personas_hogar) AS personas, " & _
        "Sum(mujeres) AS mujeres, Sum(jovenes) AS jovenes, Sum(area_declarada_ha) AS area_declarada_ha " & _
        "FROM Caracterizaciones WHERE estado = 'procesada' " & _
        "GROUP BY departamento, municipio ORDER BY departamento, municipio;"

    NuevaConsulta "Consulta 11 - Predios pendientes de delimitar", _
        "SELECT departamento, municipio, vereda, cod_predio, cod_humboldt, predio, productor, num_doc, " & _
        "fecha_caracterizacion, latitud, longitud, gps_precision_m FROM Predios " & _
        "WHERE estado_limite = 'Pendiente de delimitar' ORDER BY departamento, municipio, cod_predio;"

    NuevaConsulta "Consulta 12 - Fichas prediales (PDF)", _
        "SELECT cod_predio, predio, productor, departamento, municipio, version, fecha_registro, " & _
        "generada_por, url_ficha FROM Fichas ORDER BY departamento, municipio, cod_predio;"

    NuevaConsulta "Consulta 13 - Usos del suelo declarados", _
        "SELECT departamento, municipio, tipo_uso, cultivo, Count(*) AS registros, Sum(area_ha) AS area_ha " & _
        "FROM Usos_declarados GROUP BY departamento, municipio, tipo_uso, cultivo " & _
        "ORDER BY departamento, municipio, tipo_uso, cultivo;"
End Sub

'==========================================================================
'  MENÚ DE DESCARGAS A EXCEL (formulario Menu_Descargas)
'==========================================================================
Private Sub CrearMenuDescargas()
    Dim frm As Form, ctl As Control, tmp As String
    Dim x As Long, y As Long, i As Integer
    Dim botones As Variant, textos As Variant
    Const CM As Long = 567

    On Error Resume Next
    DoCmd.DeleteObject acForm, FORM_MENU
    Err.Clear
    On Error GoTo 0

    Set frm = CreateForm()
    tmp = frm.Name
    frm.Caption = "Sigpredial · Descargas a Excel"
    frm.RecordSelectors = False
    frm.NavigationButtons = False
    frm.DividingLines = False
    frm.ScrollBars = 0
    frm.AutoCenter = True
    frm.Width = 15 * CM
    frm.Section(acDetail).Height = 16.6 * CM
    frm.Section(acDetail).BackColor = RGB(244, 241, 231)

    Etiqueta tmp, "lblTitulo", "Descargas de Sigpredial a Excel", 0.6 * CM, 0.4 * CM, 13 * CM, 0.8 * CM, 14, True, RGB(69, 106, 62)
    Etiqueta tmp, "lblAyuda", "Elija los filtros (opcionales) y pulse el botón de lo que desea descargar. " & _
        "El archivo queda en la carpeta '" & CARPETA_DESCARGAS & "' junto a esta base, con la fecha en el nombre.", _
        0.6 * CM, 1.3 * CM, 13.8 * CM, 1 * CM, 9, False, RGB(70, 80, 70)

    ' Filtros
    Etiqueta tmp, "lblDpto", "Departamento", 0.6 * CM, 2.6 * CM, 3 * CM, 0.5 * CM, 9, True, RGB(70, 80, 70)
    Set ctl = CreateControl(tmp, acComboBox, acDetail, , , 0.6 * CM, 3.1 * CM, 6.4 * CM, 0.6 * CM)
    ctl.Name = "cboDepartamento"
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT DISTINCT departamento FROM Predios ORDER BY departamento;"
    ctl.LimitToList = True
    ctl.AfterUpdate = "=SigCambioDepartamento()"

    Etiqueta tmp, "lblMpio", "Municipio", 7.4 * CM, 2.6 * CM, 3 * CM, 0.5 * CM, 9, True, RGB(70, 80, 70)
    Set ctl = CreateControl(tmp, acComboBox, acDetail, , , 7.4 * CM, 3.1 * CM, 6.8 * CM, 0.6 * CM)
    ctl.Name = "cboMunicipio"
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT DISTINCT municipio, departamento FROM Predios ORDER BY municipio, departamento;"
    ctl.ColumnCount = 2
    ctl.ColumnWidths = CStr(4 * CM) & ";" & CStr(3 * CM)
    ctl.ListWidth = 7.2 * CM
    ctl.BoundColumn = 1
    ctl.LimitToList = True

    Etiqueta tmp, "lblDesde", "Registrado desde", 0.6 * CM, 4 * CM, 4 * CM, 0.5 * CM, 9, True, RGB(70, 80, 70)
    Set ctl = CreateControl(tmp, acTextBox, acDetail, , , 0.6 * CM, 4.5 * CM, 3.4 * CM, 0.6 * CM)
    ctl.Name = "txtDesde"
    ctl.Format = "Short Date"
    ctl.ShowDatePicker = 1

    Etiqueta tmp, "lblHasta", "hasta", 4.4 * CM, 4 * CM, 3 * CM, 0.5 * CM, 9, True, RGB(70, 80, 70)
    Set ctl = CreateControl(tmp, acTextBox, acDetail, , , 4.4 * CM, 4.5 * CM, 3.4 * CM, 0.6 * CM)
    ctl.Name = "txtHasta"
    ctl.Format = "Short Date"
    ctl.ShowDatePicker = 1

    Boton tmp, "btnLimpiar", "Quitar filtros", "=SigLimpiarFiltros()", 8.4 * CM, 4.5 * CM, 3.2 * CM

    ' Botones de descarga
    Etiqueta tmp, "lblDescargar", "Descargar a Excel", 0.6 * CM, 5.6 * CM, 6 * CM, 0.6 * CM, 11, True, RGB(69, 106, 62)
    botones = Array("Productores", "Predios", "Lotes", "Elementos", "Cultivos", "Coberturas", "DifArea", _
                    "Caracterizaciones", "UsosDeclarados", "Pendientes", "Fichas", "Todo")
    textos = Array("Productores", "Predios", "Lotes", "Elementos (vías, aguas...)", "Resumen por cultivo", _
                   "Resumen por cobertura", "Predios con diferencia de área", "Caracterizaciones (Kobo)", _
                   "Usos del suelo declarados", "Predios pendientes de delimitar", "Fichas prediales (enlaces)", _
                   "Todo en un solo libro")
    For i = 0 To UBound(botones)
        x = IIf(i Mod 2 = 0, 0.6 * CM, 7.6 * CM)
        y = 6.3 * CM + (i \ 2) * 0.95 * CM
        Boton tmp, "btn" & botones(i), CStr(textos(i)), "=SigDescargar(""" & botones(i) & """)", x, y, 6.6 * CM
    Next

    ' Ficha predial en PDF
    Etiqueta tmp, "lblFicha", "Ficha predial (PDF con el mapa)", 0.6 * CM, 12.2 * CM, 9 * CM, 0.6 * CM, 11, True, RGB(69, 106, 62)
    Set ctl = CreateControl(tmp, acComboBox, acDetail, , , 0.6 * CM, 12.9 * CM, 9.6 * CM, 0.6 * CM)
    ctl.Name = "cboFicha"
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT cod_predio, predio, municipio FROM Fichas ORDER BY cod_predio;"
    ctl.ColumnCount = 3
    ctl.ColumnWidths = CStr(2.8 * CM) & ";" & CStr(4.2 * CM) & ";" & CStr(3 * CM)
    ctl.ListWidth = 10.4 * CM
    ctl.BoundColumn = 1
    ctl.LimitToList = True
    Boton tmp, "btnAbrirFicha", "Abrir ficha PDF", "=SigAbrirFicha()", 10.6 * CM, 12.85 * CM, 3.6 * CM

    Etiqueta tmp, "lblEstado", "", 0.6 * CM, 13.9 * CM, 13.8 * CM, 1.1 * CM, 9, False, RGB(122, 110, 5)
    Boton tmp, "btnCarpeta", "Abrir carpeta de descargas", "=SigAbrirCarpeta()", 0.6 * CM, 15.3 * CM, 6.6 * CM

    DoCmd.Close acForm, tmp, acSaveYes
    DoCmd.Rename FORM_MENU, acForm, tmp
End Sub

Private Sub Etiqueta(frm As String, nombre As String, texto As String, x As Long, y As Long, w As Long, h As Long, _
                     tam As Integer, negrita As Boolean, color As Long)
    Dim ctl As Control
    Set ctl = CreateControl(frm, acLabel, acDetail, , , x, y, w, h)
    ctl.Name = nombre
    ctl.Caption = IIf(Len(texto) = 0, " ", texto)
    ctl.FontSize = tam
    ctl.FontBold = negrita
    ctl.ForeColor = color
End Sub

Private Sub Boton(frm As String, nombre As String, texto As String, accion As String, x As Long, y As Long, w As Long)
    Dim ctl As Control
    Set ctl = CreateControl(frm, acCommandButton, acDetail, , , x, y, w, 0.75 * 567)
    ctl.Name = nombre
    ctl.Caption = texto
    ctl.OnClick = accion
End Sub

'--------------------------------------------------------------------------
' Funciones que llama el formulario (deben ser públicas)
'--------------------------------------------------------------------------
Public Function SigCambioDepartamento()
    Dim f As Form, d As String
    Set f = Forms(FORM_MENU)
    d = Nz(f!cboDepartamento, "")
    f!cboMunicipio = Null
    If Len(d) = 0 Then
        f!cboMunicipio.RowSource = "SELECT DISTINCT municipio, departamento FROM Predios ORDER BY municipio, departamento;"
    Else
        f!cboMunicipio.RowSource = "SELECT DISTINCT municipio, departamento FROM Predios WHERE departamento = " & _
                                   Texto(d) & " ORDER BY municipio;"
    End If
    f!cboMunicipio.Requery
    If Len(d) = 0 Then
        f!cboFicha.RowSource = "SELECT cod_predio, predio, municipio FROM Fichas ORDER BY cod_predio;"
    Else
        f!cboFicha.RowSource = "SELECT cod_predio, predio, municipio FROM Fichas WHERE departamento = " & _
                               Texto(d) & " ORDER BY cod_predio;"
    End If
    f!cboFicha = Null
    f!cboFicha.Requery
End Function

Public Function SigLimpiarFiltros()
    Dim f As Form
    Set f = Forms(FORM_MENU)
    f!cboDepartamento = Null
    f!txtDesde = Null
    f!txtHasta = Null
    SigCambioDepartamento
    f!lblEstado.Caption = " "
End Function

' Abre en el navegador la ficha predial (PDF) del predio elegido
Public Function SigAbrirFicha()
    Dim f As Form, cod As String, url As Variant
    On Error GoTo ErrH
    Set f = Forms(FORM_MENU)
    cod = Nz(f!cboFicha, "")
    If Len(cod) = 0 Then
        MsgBox "Elija un predio de la lista de fichas guardadas.", vbInformation, "Sigpredial"
        Exit Function
    End If
    url = DLookup("url_ficha", "Fichas", "cod_predio = " & Texto(cod))
    If IsNull(url) Then
        MsgBox "Ese predio no tiene ficha guardada. Se guarda desde el portal (Ficha predial > Guardar en Sigpredial).", _
               vbInformation, "Sigpredial"
        Exit Function
    End If
    Application.FollowHyperlink CStr(url)
    f!lblEstado.Caption = "Abriendo la ficha del predio " & cod & " en el navegador..."
    Exit Function
ErrH:
    MsgBox "No se pudo abrir la ficha." & vbCrLf & "Error " & Err.Number & ": " & Err.Description, vbExclamation, "Sigpredial"
End Function

Public Function SigAbrirCarpeta()
    Shell "explorer.exe """ & Carpeta() & """", vbNormalFocus
End Function

Public Function SigDescargar(que As String)
    Dim archivo As String, lista As Variant, i As Integer, n As Long, f As Form
    On Error GoTo ErrH
    Set f = Forms(FORM_MENU)
    If Not FechasValidas() Then Exit Function

    If que = "Todo" Then
        lista = Array("Productores", "Predios", "Lotes", "Elementos", "Cultivos", "Coberturas", "DifArea", _
                      "Caracterizaciones", "UsosDeclarados", "Pendientes", "Fichas")
    Else
        lista = Array(que)
    End If

    archivo = Carpeta() & "\Sigpredial_" & IIf(que = "Todo", "Completo", que) & SufijoFiltros() & "_" & _
              Format(Now, "yyyy-mm-dd_hhnn") & ".xlsx"

    DoCmd.Hourglass True
    For i = 0 To UBound(lista)
        n = n + ExportarHoja(CStr(lista(i)), archivo)
    Next
    DoCmd.Hourglass False

    f!lblEstado.Caption = "Descargado: " & Mid(archivo, InStrRev(archivo, "\") + 1) & " (" & n & " filas)."
    Shell "explorer.exe /select,""" & archivo & """", vbNormalFocus
    Exit Function

ErrH:
    DoCmd.Hourglass False
    MsgBox "No se pudo descargar." & vbCrLf & "Error " & Err.Number & ": " & Err.Description, vbExclamation, "Sigpredial"
End Function

' Crea la consulta filtrada, la exporta como una hoja del libro y devuelve el número de filas
Private Function ExportarHoja(que As String, archivo As String) As Long
    Dim sql As String, hoja As String, w As String

    Select Case que
    Case "Productores"
        w = FiltroFecha("fecha_registro")
        If Len(FiltroLugar("")) > 0 Then
            w = Unir(w, "id IN (SELECT productor_id FROM Predios WHERE " & FiltroLugar("") & ")")
        End If
        sql = "SELECT * FROM Productores" & Donde(w) & " ORDER BY nombre_completo;"
    Case "Predios"
        sql = "SELECT * FROM Predios" & Donde(Unir(FiltroLugar(""), FiltroFecha("fecha_registro"))) & _
              " ORDER BY departamento, municipio, cod_predio;"
    Case "Lotes"
        sql = "SELECT * FROM Lotes" & Donde(Unir(FiltroLugar(""), FiltroFecha("fecha_registro"))) & _
              " ORDER BY departamento, municipio, cod_lote;"
    Case "Elementos"
        sql = "SELECT * FROM Elementos" & Donde(Unir(FiltroLugar(""), FiltroFecha("fecha_registro"))) & _
              " ORDER BY departamento, municipio, cod_predio, geometria, tipo;"
    Case "Cultivos"
        sql = "SELECT departamento, municipio, tipo_cobertura, cultivo, Count(*) AS n_lotes, " & _
              "Sum(IIf(IsNull(area_sig_ha), area_declarada_ha, area_sig_ha)) AS area_ha, " & _
              "Sum(num_plantas) AS plantas, Sum(sitios_estimados) AS sitios_estimados FROM Lotes" & _
              Donde(Unir(FiltroLugar(""), FiltroFecha("fecha_registro"))) & _
              " GROUP BY departamento, municipio, tipo_cobertura, cultivo ORDER BY departamento, municipio, cultivo;"
    Case "Coberturas"
        sql = "SELECT departamento, municipio, tipo_cobertura, Count(*) AS n_lotes, " & _
              "Sum(IIf(IsNull(area_sig_ha), area_declarada_ha, area_sig_ha)) AS area_ha FROM Lotes" & _
              Donde(Unir(FiltroLugar(""), FiltroFecha("fecha_registro"))) & _
              " GROUP BY departamento, municipio, tipo_cobertura ORDER BY departamento, municipio, tipo_cobertura;"
    Case "DifArea"
        sql = "SELECT cod_predio, predio, productor, num_doc, departamento, municipio, vereda, " & _
              "area_declarada_ha, area_sig_ha, dif_area_pct FROM Predios" & _
              Donde(Unir(Unir("Abs(dif_area_pct) > 30", FiltroLugar("")), FiltroFecha("fecha_registro"))) & _
              " ORDER BY Abs(dif_area_pct) DESC;"
    Case "Caracterizaciones"
        sql = "SELECT * FROM Caracterizaciones" & Donde(Unir(FiltroLugar(""), FiltroFecha("fecha_registro"))) & _
              " ORDER BY departamento, municipio, fecha_visita;"
    Case "UsosDeclarados"
        sql = "SELECT * FROM Usos_declarados" & Donde(Unir(FiltroLugar(""), FiltroFecha("fecha_registro"))) & _
              " ORDER BY departamento, municipio, cod_predio, tipo_uso;"
    Case "Pendientes"
        sql = "SELECT departamento, municipio, vereda, cod_predio, cod_humboldt, predio, productor, num_doc, " & _
              "fecha_caracterizacion, latitud, longitud, gps_precision_m FROM Predios" & _
              Donde(Unir(Unir("estado_limite = 'Pendiente de delimitar'", FiltroLugar("")), FiltroFecha("fecha_registro"))) & _
              " ORDER BY departamento, municipio, cod_predio;"
    Case "Fichas"
        sql = "SELECT cod_predio, predio, productor, departamento, municipio, version, fecha_registro, " & _
              "generada_por, url_ficha FROM Fichas" & Donde(Unir(FiltroLugar(""), FiltroFecha("fecha_registro"))) & _
              " ORDER BY departamento, municipio, cod_predio;"
    End Select

    hoja = NombreHoja(que)
    NuevaConsulta hoja, sql
    ExportarHoja = DCount("*", hoja)
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, hoja, archivo, True
End Function

Private Function NombreHoja(que As String) As String
    Select Case que
    Case "Cultivos":   NombreHoja = "Resumen por cultivo"
    Case "Coberturas": NombreHoja = "Resumen por cobertura"
    Case "DifArea":    NombreHoja = "Predios dif area"
    Case "UsosDeclarados": NombreHoja = "Usos declarados"
    Case "Pendientes": NombreHoja = "Pendientes de delimitar"
    Case "Fichas":     NombreHoja = "Fichas prediales"
    Case Else:         NombreHoja = que & " (descarga)"
    End Select
End Function

'--------------------------------------------------------------------------
' Filtros
'--------------------------------------------------------------------------
Private Function FiltroLugar(prefijo As String) As String
    Dim f As Form, d As String, m As String, dm As String
    Set f = Forms(FORM_MENU)
    d = Nz(f!cboDepartamento, "")
    m = Nz(f!cboMunicipio, "")
    If Len(m) > 0 Then
        dm = Nz(f!cboMunicipio.Column(1), "")
        If Len(dm) > 0 Then d = dm
        FiltroLugar = prefijo & "municipio = " & Texto(m)
    End If
    If Len(d) > 0 Then FiltroLugar = Unir(FiltroLugar, prefijo & "departamento = " & Texto(d))
End Function

Private Function FiltroFecha(campo As String) As String
    Dim f As Form
    Set f = Forms(FORM_MENU)
    If Not IsNull(f!txtDesde) Then FiltroFecha = campo & " >= " & Format(CDate(f!txtDesde), "\#yyyy\-mm\-dd\#")
    If Not IsNull(f!txtHasta) Then
        FiltroFecha = Unir(FiltroFecha, campo & " < " & Format(CDate(f!txtHasta) + 1, "\#yyyy\-mm\-dd\#"))
    End If
End Function

Private Function FechasValidas() As Boolean
    Dim f As Form
    Set f = Forms(FORM_MENU)
    If Not IsNull(f!txtDesde) Then
        If Not IsDate(f!txtDesde) Then MsgBox "La fecha inicial no es válida.", vbExclamation: Exit Function
    End If
    If Not IsNull(f!txtHasta) Then
        If Not IsDate(f!txtHasta) Then MsgBox "La fecha final no es válida.", vbExclamation: Exit Function
    End If
    If Not IsNull(f!txtDesde) And Not IsNull(f!txtHasta) Then
        If CDate(f!txtDesde) > CDate(f!txtHasta) Then
            MsgBox "La fecha inicial es posterior a la final.", vbExclamation: Exit Function
        End If
    End If
    FechasValidas = True
End Function

Private Function SufijoFiltros() As String
    Dim f As Form, s As String
    Set f = Forms(FORM_MENU)
    If Len(Nz(f!cboMunicipio, "")) > 0 Then
        s = "_" & Limpio(f!cboMunicipio)
    ElseIf Len(Nz(f!cboDepartamento, "")) > 0 Then
        s = "_" & Limpio(f!cboDepartamento)
    End If
    If Not IsNull(f!txtDesde) Or Not IsNull(f!txtHasta) Then
        s = s & "_" & IIf(IsNull(f!txtDesde), "inicio", Format(CDate(Nz(f!txtDesde, Date)), "yyyymmdd")) & _
            "-" & IIf(IsNull(f!txtHasta), "hoy", Format(CDate(Nz(f!txtHasta, Date)), "yyyymmdd"))
    End If
    SufijoFiltros = s
End Function

Private Function Limpio(ByVal s As String) As String
    Dim c As Variant
    For Each c In Array("\", "/", ":", "*", "?", """", "<", ">", "|", ".", ",")
        s = Replace(s, CStr(c), "")
    Next
    Limpio = Replace(Trim(s), " ", "_")
End Function

Private Function Texto(s As String) As String
    Texto = "'" & Replace(s, "'", "''") & "'"
End Function

Private Function Unir(a As String, b As String) As String
    If Len(a) = 0 Then
        Unir = b
    ElseIf Len(b) = 0 Then
        Unir = a
    Else
        Unir = a & " AND " & b
    End If
End Function

Private Function Donde(w As String) As String
    If Len(w) > 0 Then Donde = " WHERE " & w
End Function

Private Function Carpeta() As String
    Carpeta = CurrentProject.Path & "\" & CARPETA_DESCARGAS
    If Len(Dir(Carpeta, vbDirectory)) = 0 Then MkDir Carpeta
End Function
